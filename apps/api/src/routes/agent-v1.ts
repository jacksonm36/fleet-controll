import { prisma } from "@fleet/db";
import type { JobStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { invalidateFleetCaches } from "../lib/cache.js";
import {
  agentNeedsBinaryUpdate,
  normalizeAgentArch,
  readAgentManifest,
  releaseForArch,
} from "../lib/agent-release.js";
import {
  agentMatchesReleaseBuild,
  reconcileAllStaleBinaryUpgrades,
  reconcileBinaryUpgradeFlags,
} from "../lib/binary-upgrade-reconcile.js";
import { reconcileStaleJobsForAgent } from "../lib/job-reconcile.js";
import { persistAgentCves } from "../lib/cve-scan.js";
import { emitJobLog } from "../lib/job-bus.js";
import {
  writeAgentMetricsToInflux,
} from "../lib/influx.js";
import {
  clientIpFromRequest,
  connectedIpFallbackUpdate,
  hostIpUpdateFromPayload,
} from "../lib/client-ip.js";
import {
  appendBinaryDeployEvent,
  noteBinaryDeployFailure,
  noteBinaryDeployHeartbeatSuccess,
} from "../lib/binary-deploy-bus.js";
import {
  handlePatchExecuteJobComplete,
  handlePatchPlanJobComplete,
} from "../lib/patch-plans.js";
import { requireAgent } from "../middleware/agent-auth.js";

const inventoryPackageSchema = z.object({
  name: z.string().min(1),
  version: z.preprocess(
    (v) => (v == null || v === "" ? "" : String(v)),
    z.string(),
  ),
  manager: z.string().min(1),
  source: z.string().optional().nullable(),
  updateAvailable: z.boolean().optional().default(false),
  availableVersion: z.string().optional().nullable(),
});

const inventoryVulnSchema = z.object({
  cveId: z.string().min(4),
  packageName: z.string().optional().nullable(),
  packageVersion: z.string().optional().nullable(),
  manager: z.string().optional().nullable(),
  severity: z
    .enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"])
    .optional()
    .nullable(),
  summary: z.string().optional().nullable(),
  fixedVersion: z.string().optional().nullable(),
  source: z.string().min(1),
});

const inventoryKernelSchema = z
  .object({
    running: z.string().optional().nullable(),
    latestInstalled: z.string().optional().nullable(),
    updatePending: z.boolean().optional().nullable(),
    rebootRequired: z.boolean().optional().nullable(),
  })
  .optional()
  .nullable();

const inventoryServiceSchema = z.object({
  name: z.string().min(1),
  kind: z.enum([
    "systemd",
    "windows_service",
    "docker",
    "podman",
    "snap",
    "launchd",
  ]),
  state: z.string(),
  enabled: z.boolean().optional().nullable(),
  detail: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
});

const inventoryContainerSchema = z.object({
  name: z.string().min(1),
  image: z.union([z.string(), z.number()]).transform(String).default("unknown"),
  imageId: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
  runtime: z.enum(["docker", "podman"]),
  status: z.string(),
  ports: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
  composeProject: z
    .union([z.string(), z.number()])
    .transform(String)
    .optional()
    .nullable(),
});

const inventorySchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal("1")]).transform(() => 1 as const),
  collectedAt: z.string(),
  packages: z.array(inventoryPackageSchema).default([]),
  services: z.array(inventoryServiceSchema).default([]),
  containers: z.array(inventoryContainerSchema).optional().nullable().default([]),
  kernel: inventoryKernelSchema,
  packageUpdatesPending: z.coerce.number().optional().default(0),
  vulnerabilities: z.array(inventoryVulnSchema).optional().default([]),
  osDetail: z.string().optional(),
  rebootRequired: z.boolean().optional().nullable(),
  crowdsecInstalled: z.boolean().optional().nullable(),
  host: z
    .object({
      primaryIp: z.string().optional().nullable(),
      addresses: z.array(z.string()).optional().nullable(),
    })
    .optional()
    .nullable(),
});

const metricsNumber = z.coerce.number().optional().default(0);

const metricsSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal("1")]).transform(() => 1 as const),
  collectedAt: z.string(),
  cpu: z
    .object({
      percent: metricsNumber,
      cores: z.coerce.number().optional(),
    })
    .optional()
    .default({ percent: 0 }),
  memory: z
    .object({
      totalBytes: metricsNumber,
      usedBytes: metricsNumber,
      usedPercent: metricsNumber,
    })
    .optional()
    .default({ totalBytes: 0, usedBytes: 0, usedPercent: 0 }),
  network: z
    .object({
      rxBps: metricsNumber,
      txBps: metricsNumber,
    })
    .optional()
    .default({ rxBps: 0, txBps: 0 }),
  disk: z
    .object({
      rootUsedPercent: metricsNumber,
    })
    .optional()
    .default({ rootUsedPercent: 0 }),
  load: z
    .object({
      load1: metricsNumber,
      load5: metricsNumber,
      load15: metricsNumber,
    })
    .optional()
    .default({ load1: 0, load5: 0, load15: 0 }),
  users: z
    .object({
      loggedIn: z.coerce.number().optional().default(0),
    })
    .optional()
    .default({ loggedIn: 0 }),
  health: z
    .object({
      score: z.coerce.number().optional().default(100),
      status: z.string().optional().default("healthy"),
    })
    .optional()
    .default({ score: 100, status: "healthy" }),
  host: z
    .object({
      primaryIp: z.string().optional().nullable(),
      addresses: z.array(z.string()).optional().nullable(),
    })
    .optional()
    .nullable(),
});

const serviceKindMap = {
  systemd: "systemd",
  windows_service: "windows_service",
  docker: "docker",
  podman: "podman",
  snap: "snap",
  launchd: "launchd",
} as const;

const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: z.string(),
  healthy: z.boolean().optional(),
  version: z.string().optional(),
  alerts: z.array(z.unknown()).optional(),
  decisions: z.array(z.unknown()).optional(),
  bouncers: z.array(z.unknown()).optional(),
  raw: z.record(z.unknown()).optional(),
});

export async function agentV1Routes(app: FastifyInstance) {
  app.post(
    "/heartbeat",
    { preHandler: requireAgent },
    async (req, reply) => {
      const agentId = req.agentCtx!.agentId;
      const bodySchema = z.object({
        version: z.string().optional(),
        build: z.string().optional(),
        arch: z.string().optional(),
      });
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

      const manifest = readAgentManifest();
      const archKey = normalizeAgentArch(parsed.data.arch);
      const agentBuild = parsed.data.build ?? null;
      const agentVersion = parsed.data.version ?? null;

      const agentRow = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { primaryIp: true },
      });

      await prisma.agent.update({
        where: { id: agentId },
        data: {
          lastSeenAt: new Date(),
          status: "ONLINE",
          ...(parsed.data.version ? { version: parsed.data.version.slice(0, 64) } : {}),
          ...connectedIpFallbackUpdate(
            agentRow?.primaryIp,
            clientIpFromRequest(req),
          ),
        },
      });

      await reconcileBinaryUpgradeFlags({
        agentId,
        agentBuild,
        agentVersion,
        agentArch: parsed.data.arch,
        heartbeat: true,
      });
      await reconcileStaleJobsForAgent(agentId);

      const forcedBuildId = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { binaryUpgradeForcedBuildId: true },
      });

      let binaryUpdate: {
        version: string;
        buildId: string;
        sha256: string;
        asset: string;
        url: string;
        force?: boolean;
      } | null = null;

      const canAssessBinaryUpdate = !!manifest && !!archKey;

      if (canAssessBinaryUpdate) {
        const rel = releaseForArch(manifest!, archKey!);
        if (rel) {
          const needsBinaryUpdate = agentNeedsBinaryUpdate(
            manifest!,
            archKey!,
            agentBuild,
            agentVersion,
          );

          const onTargetBuild = !needsBinaryUpdate;

          // Already on this build — clear forced rollout flags even if push left forcedBuildId set.
          if (onTargetBuild && forcedBuildId?.binaryUpgradeForcedBuildId) {
            const agentRow = await prisma.agent.findUnique({
              where: { id: agentId },
              select: { hostname: true },
            });
            if (agentRow) {
              noteBinaryDeployHeartbeatSuccess({
                agentId,
                hostname: agentRow.hostname,
                buildId: rel.buildId,
                version: agentVersion ?? rel.version,
              });
            }
            await prisma.agent.update({
              where: { id: agentId },
              data: {
                binaryUpgradeInProgress: false,
                binaryUpgradeStartedAt: null,
                binaryUpgradeForcedBuildId: null,
                binaryUpgradeLastError: null,
              },
            });
          }

          const forcedMatch =
            !onTargetBuild &&
            !!forcedBuildId?.binaryUpgradeForcedBuildId &&
            forcedBuildId.binaryUpgradeForcedBuildId
              .toLowerCase()
              .trim() === rel.buildId.toLowerCase().trim();

          const shouldOffer = needsBinaryUpdate || forcedMatch;

          if (shouldOffer) {
            binaryUpdate = {
              version: rel.version,
              buildId: rel.buildId,
              sha256: rel.sha256,
              asset: rel.file,
              url: `/api/public/${rel.file}`,
              // When forced, the agent should apply even if auto-update is disabled.
              force: forcedMatch,
            };
          } else {
            const agentRow = await prisma.agent.findUnique({
              where: { id: agentId },
              select: { hostname: true, binaryUpgradeForcedBuildId: true },
            });
            if (
              agentRow?.binaryUpgradeForcedBuildId &&
              rel &&
              agentMatchesReleaseBuild(agentVersion, agentBuild, rel.buildId)
            ) {
              noteBinaryDeployHeartbeatSuccess({
                agentId,
                hostname: agentRow.hostname,
                buildId: rel.buildId,
                version: agentVersion ?? rel.version,
              });
            }
            await prisma.agent.update({
              where: { id: agentId },
              data: {
                binaryUpgradeInProgress: false,
                binaryUpgradeStartedAt: null,
                binaryUpgradeForcedBuildId: null,
                binaryUpgradeLastError: null,
              },
            });
          }
        }
      }

      return { ok: true, ...(binaryUpdate ? { binaryUpdate } : {}) };
    },
  );

  app.post(
    "/binary-update-state",
    { preHandler: requireAgent },
    async (req, reply) => {
      const agentId = req.agentCtx!.agentId;
      const schema = z.object({
        inProgress: z.boolean(),
        error: z.string().max(2000).nullable().optional(),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { hostname: true, binaryUpgradeForcedBuildId: true },
      });

      await prisma.agent.update({
        where: { id: agentId },
        data: {
          binaryUpgradeInProgress: parsed.data.inProgress,
          ...(parsed.data.inProgress
            ? {
                binaryUpgradeStartedAt: new Date(),
                binaryUpgradeLastError: null,
              }
            : {
                binaryUpgradeStartedAt: null,
                ...(parsed.data.error !== undefined
                  ? { binaryUpgradeLastError: parsed.data.error }
                  : { binaryUpgradeLastError: null }),
              }),
        },
      });

      if (agent) {
        const manifest = readAgentManifest();
        const deployVersion = manifest?.version ?? "0.4.0";
        const deployBuildId =
          agent.binaryUpgradeForcedBuildId ?? manifest?.buildId ?? null;

        if (parsed.data.inProgress) {
          appendBinaryDeployEvent({
            buildId: deployBuildId,
            version: deployVersion,
            agentId,
            hostname: agent.hostname,
            phase: "install",
            level: "info",
            message: `${agent.hostname} started binary upgrade`,
          });
        } else if (parsed.data.error) {
          noteBinaryDeployFailure({
            agentId,
            hostname: agent.hostname,
            buildId: deployBuildId,
            version: deployVersion,
            message: parsed.data.error,
          });
        }
      }

      return { ok: true };
    },
  );

  app.post(
    "/binary-update-event",
    { preHandler: requireAgent },
    async (req, reply) => {
      const agentId = req.agentCtx!.agentId;
      const schema = z.object({
        phase: z
          .enum([
            "queued",
            "notify",
            "download",
            "verify",
            "install",
            "restart",
            "online",
            "failed",
            "info",
          ])
          .optional()
          .default("info"),
        level: z
          .enum(["info", "warn", "error", "success"])
          .optional()
          .default("info"),
        message: z.string().min(1).max(2000),
        buildId: z.string().max(128).optional().nullable(),
      });
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { hostname: true, binaryUpgradeForcedBuildId: true },
      });
      if (!agent) return reply.code(404).send({ error: "not_found" });

      const manifest = readAgentManifest();
      appendBinaryDeployEvent({
        buildId:
          parsed.data.buildId ??
          agent.binaryUpgradeForcedBuildId ??
          manifest?.buildId ??
          undefined,
        version: manifest?.version,
        agentId,
        hostname: agent.hostname,
        phase: parsed.data.phase,
        level: parsed.data.level,
        message: parsed.data.message,
      });

      return { ok: true };
    },
  );

  app.post(
    "/inventory",
    { preHandler: requireAgent },
    async (req, reply) => {
      const agentId = req.agentCtx!.agentId;
      const parsed = inventorySchema.safeParse(req.body);
      if (!parsed.success) {
        req.log.warn(
          { issues: parsed.error.issues.slice(0, 8) },
          "inventory validation failed",
        );
        return reply.code(400).send({
          error: "invalid_body",
          issues: parsed.error.issues.slice(0, 8),
        });
      }
      const inv = parsed.data;

      await prisma.$transaction(async (tx) => {
        await tx.packageRecord.deleteMany({ where: { agentId } });
        await tx.serviceRecord.deleteMany({ where: { agentId } });
        await tx.containerRecord.deleteMany({ where: { agentId } });
        if (inv.packages.length) {
          const seenPkg = new Set<string>();
          const packageRows = inv.packages
            .map((p) => ({
              agentId,
              name: p.name.slice(0, 255),
              version: (p.version || "").slice(0, 255),
              manager: p.manager.slice(0, 64),
              source: p.source?.slice(0, 255) ?? null,
              updateAvailable: p.updateAvailable ?? false,
              availableVersion: p.availableVersion?.slice(0, 255) ?? null,
            }))
            .filter((row) => {
              const key = `${row.name}\0${row.manager}`;
              if (seenPkg.has(key)) return false;
              seenPkg.add(key);
              return true;
            });
          if (packageRows.length) {
            await tx.packageRecord.createMany({ data: packageRows });
          }
        }
        if (inv.services.length) {
          const seenSvc = new Set<string>();
          const serviceRows = inv.services
            .map((s) => {
              const kind =
                serviceKindMap[s.kind as keyof typeof serviceKindMap] ??
                "systemd";
              return {
                agentId,
                name: s.name.slice(0, 255),
                kind,
                state: s.state.slice(0, 128),
                enabled: s.enabled ?? null,
                detail: s.detail?.slice(0, 512) ?? null,
              };
            })
            .filter((row) => {
              const key = `${row.name}\0${row.kind}`;
              if (seenSvc.has(key)) return false;
              seenSvc.add(key);
              return true;
            });
          if (serviceRows.length) {
            await tx.serviceRecord.createMany({ data: serviceRows });
          }
        }
        const containers = inv.containers ?? [];
        if (containers.length) {
          await tx.containerRecord.createMany({
            data: containers.map((c) => ({
              agentId,
              name: c.name.slice(0, 255),
              image: c.image.slice(0, 512),
              imageId: c.imageId?.slice(0, 128) ?? null,
              runtime: c.runtime,
              status: c.status.slice(0, 128),
              ports: c.ports?.slice(0, 512) ?? null,
              composeProject: c.composeProject?.slice(0, 128) ?? null,
            })),
          });
        }
        const kernel = inv.kernel ?? null;
        const pkgPending =
          inv.packageUpdatesPending ??
          inv.packages.filter((p) => p.updateAvailable).length;

        await tx.agent.update({
          where: { id: agentId },
          data: {
            rebootRequired:
              inv.rebootRequired ??
              kernel?.rebootRequired ??
              false,
            crowdsecInstalled: inv.crowdsecInstalled ?? false,
            kernelRunning: kernel?.running?.slice(0, 128) ?? null,
            kernelInstalled: kernel?.latestInstalled?.slice(0, 128) ?? null,
            kernelUpdatePending: kernel?.updatePending ?? false,
            packageUpdatesPending: pkgPending,
            lastSeenAt: new Date(),
            status: "ONLINE",
            ...hostIpUpdateFromPayload(inv.host, clientIpFromRequest(req)),
            ...(inv.osDetail && /^(NAME|ID|VERSION_ID)=/m.test(inv.osDetail)
              ? { osDetail: inv.osDetail.slice(0, 4096) }
              : {}),
          },
        });
      });

      const agentMeta = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { osType: true, osDetail: true },
      });

      let cveStats = { cveCount: 0, cveCriticalCount: 0, cveHighCount: 0 };
      if (agentMeta) {
        try {
          cveStats = await persistAgentCves(
            agentId,
            inv.vulnerabilities ?? [],
            agentMeta.osType,
            agentMeta.osDetail,
            inv.packages.map((p) => ({
              name: p.name,
              version: p.version,
              manager: p.manager,
            })),
          );
        } catch (err) {
          req.log.warn({ err }, "CVE scan failed");
        }
      }

      await invalidateFleetCaches(agentId);
      const pkgPendingCount = inv.packages.filter(
        (p) => p.updateAvailable,
      ).length;
      return {
        ok: true,
        received: {
          packages: inv.packages.length,
          services: inv.services.length,
          containers: (inv.containers ?? []).length,
          packageUpdatesPending: pkgPendingCount,
          kernelUpdatePending: inv.kernel?.updatePending ?? false,
          vulnerabilities: inv.vulnerabilities?.length ?? 0,
          cveCount: cveStats.cveCount,
        },
      };
    },
  );

  app.post(
    "/crowdsec/snapshot",
    { preHandler: requireAgent },
    async (req, reply) => {
      const agentId = req.agentCtx!.agentId;
      const parsed = snapshotSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

      await prisma.crowdSecSnapshot.upsert({
        where: { agentId },
        create: {
          agentId,
          payload: parsed.data as object,
        },
        update: {
          payload: parsed.data as object,
          capturedAt: new Date(),
        },
      });

      await prisma.agent.update({
        where: { id: agentId },
        data: { crowdsecInstalled: true, lastSeenAt: new Date(), status: "ONLINE" },
      });

      await invalidateFleetCaches(agentId);
      return { ok: true };
    },
  );

  app.post(
    "/metrics",
    { preHandler: requireAgent },
    async (req, reply) => {
      const agentId = req.agentCtx!.agentId;
      const parsed = metricsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_body",
          issues: parsed.error.issues.slice(0, 6),
        });
      }
      const m = parsed.data;
      const collectedAt = new Date(m.collectedAt);
      if (Number.isNaN(collectedAt.getTime())) {
        return reply.code(400).send({ error: "invalid_collected_at" });
      }

      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { hostname: true, osType: true },
      });
      if (!agent) return reply.code(404).send({ error: "not_found" });

      const cpuPercent = m.cpu?.percent ?? 0;
      const memUsedPercent = m.memory?.usedPercent ?? 0;
      const load1 = m.load?.load1 ?? 0;
      const networkRxBps = m.network?.rxBps ?? 0;
      const networkTxBps = m.network?.txBps ?? 0;
      const diskRootUsedPercent = m.disk?.rootUsedPercent ?? 0;
      const loggedInUsers = m.users?.loggedIn ?? 0;
      const healthScore = Math.round(m.health?.score ?? 100);
      const healthStatus = (m.health?.status ?? "healthy").slice(0, 32);

      await prisma.agent.update({
        where: { id: agentId },
        data: {
          lastMetricsAt: collectedAt,
          lastSeenAt: new Date(),
          status: "ONLINE",
          cpuPercent,
          memUsedPercent,
          load1,
          networkRxBps,
          networkTxBps,
          diskRootUsedPercent,
          loggedInUsers,
          healthScore,
          healthStatus,
          ...hostIpUpdateFromPayload(m.host, clientIpFromRequest(req)),
        },
      });

      try {
        await writeAgentMetricsToInflux({
          agentId,
          hostname: agent.hostname,
          osType: agent.osType,
          collectedAt,
          cpuPercent,
          memUsedPercent,
          load1,
          networkRxBps,
          networkTxBps,
          diskRootUsedPercent,
          loggedInUsers,
          healthScore,
          healthStatus,
        });
      } catch (err) {
        req.log.warn({ err }, "InfluxDB metrics write failed");
      }

      await invalidateFleetCaches(agentId);
      return { ok: true };
    },
  );

  app.get(
    "/commands",
    { preHandler: requireAgent },
    async (req, reply) => {
      const agentId = req.agentCtx!.agentId;
      await prisma.agent.update({
        where: { id: agentId },
        data: { lastSeenAt: new Date(), status: "ONLINE" },
      });

      await reconcileStaleJobsForAgent(agentId);

      const blockingRunning = await prisma.job.findFirst({
        where: { agentId, status: "RUNNING" },
        select: { id: true },
      });
      if (blockingRunning) {
        await invalidateFleetCaches(agentId);
        return reply.code(204).send();
      }

      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        const job = await prisma.job.findFirst({
          where: { agentId, status: "QUEUED" },
          orderBy: { createdAt: "asc" },
        });
        if (job) {
          const updated = await prisma.job.update({
            where: { id: job.id },
            data: { status: "RUNNING", startedAt: new Date() },
          });
          return updated;
        }
        const pollMs = Number(process.env.AGENT_JOB_POLL_MS ?? 600);
        await new Promise((r) => setTimeout(r, pollMs));
      }
      await invalidateFleetCaches(agentId);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { jobId: string } }>(
    "/jobs/:jobId/log",
    { preHandler: requireAgent },
    async (req, reply) => {
      const agentId = req.agentCtx!.agentId;
      const schema = z.object({ message: z.string() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

      const job = await prisma.job.findUnique({
        where: { id: req.params.jobId },
      });
      if (!job || job.agentId !== agentId) {
        return reply.code(404).send({ error: "not_found" });
      }

      const agg = await prisma.jobLogChunk.aggregate({
        where: { jobId: job.id },
        _max: { seq: true },
      });
      const seq = (agg._max.seq ?? 0) + 1;
      await prisma.jobLogChunk.create({
        data: {
          jobId: job.id,
          seq,
          message: parsed.data.message,
        },
      });
      emitJobLog(job.id, parsed.data.message);

      return { seq };
    },
  );

  app.post<{ Params: { jobId: string } }>(
    "/jobs/:jobId/complete",
    { preHandler: requireAgent },
    async (req, reply) => {
      const agentId = req.agentCtx!.agentId;
      const schema = z.object({
        status: z.enum(["COMPLETED", "FAILED", "CANCELLED"]),
        errorMessage: z.string().optional(),
        result: z.record(z.unknown()).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

      const job = await prisma.job.findUnique({
        where: { id: req.params.jobId },
      });
      if (!job || job.agentId !== agentId) {
        return reply.code(404).send({ error: "not_found" });
      }

      const status = parsed.data.status as JobStatus;

      await prisma.job.update({
        where: { id: job.id },
        data: {
          status,
          finishedAt: new Date(),
          errorMessage: parsed.data.errorMessage,
          ...(parsed.data.result !== undefined
            ? { result: parsed.data.result as object }
            : {}),
        },
      });

      if (job.type === "PACKAGE_PATCH_PLAN") {
        await handlePatchPlanJobComplete(
          job,
          status,
          parsed.data.result,
          parsed.data.errorMessage,
        );
      } else if (job.type === "PACKAGE_UPGRADE") {
        await handlePatchExecuteJobComplete(
          job,
          status,
          parsed.data.result,
        );
      }

      await invalidateFleetCaches(agentId);
      return { ok: true };
    },
  );
}
