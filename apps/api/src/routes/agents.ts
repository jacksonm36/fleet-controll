import { prisma } from "@fleet/db";
import type { JobType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cacheWrap, invalidateFleetCaches } from "../lib/cache.js";
import { isAgentOnline } from "../lib/agent-presence.js";
import {
  agentDeployState,
  appendBinaryDeployEvent,
  ensureBinaryDeploySession,
  getActiveBinaryDeploySession,
  getBinaryDeploySession,
  listBinaryDeploySessions,
  mergeDeployEventLog,
  refreshBinaryDeploySessionStatus,
  startBinaryDeploySession,
  supersedeBinaryDeploySessions,
} from "../lib/binary-deploy-bus.js";
import {
  agentMatchesReleaseBuild,
  reconcileAllStaleBinaryUpgrades,
} from "../lib/binary-upgrade-reconcile.js";
import { assertOperator, requireUser } from "../middleware/auth.js";
import { disconnectAgent, notifyAgent } from "../lib/agent-sockets.js";
import { readAgentManifest } from "../lib/agent-release.js";

const updateAgentSchema = z.object({
  hostname: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(128, "Name is too long")
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
      "Use letters, numbers, dots, dashes, or underscores",
    ),
});

function mapAgentRow(
  agent: {
    enrolledAt: Date;
    lastSeenAt: Date | null;
    status: string;
    credential?: { createdAt: Date } | null;
    [key: string]: unknown;
  },
  now = Date.now(),
) {
  const { credential, ...rest } = agent;
  const enrolledAt = agent.enrolledAt ?? credential?.createdAt ?? null;
  return {
    ...rest,
    enrolledAt,
    online: isAgentOnline(agent.lastSeenAt, agent.status, now),
  };
}

type DeployAgentRow = {
  id: string;
  hostname: string;
  online: boolean;
  version: string | null;
  binaryUpgradeInProgress: boolean;
  binaryUpgradeLastError: string | null;
  binaryUpgradeForcedBuildId: string | null;
};

function agentsInActiveRollout(
  manifest: { buildId: string },
  agents: DeployAgentRow[],
): DeployAgentRow[] {
  const bid = manifest.buildId.toLowerCase().trim();
  const flagged = agents.filter((a) => {
    if (a.binaryUpgradeForcedBuildId?.toLowerCase().trim() === bid) return true;
    if (a.binaryUpgradeInProgress) return true;
    if (!a.binaryUpgradeLastError?.trim()) return false;
    if (a.binaryUpgradeForcedBuildId?.toLowerCase().trim() === bid) return true;
    return !agentMatchesReleaseBuild(a.version, null, manifest.buildId);
  });
  if (flagged.length) return flagged;

  return agents.filter(
    (a) =>
      a.online &&
      !agentMatchesReleaseBuild(a.version, null, manifest.buildId),
  );
}

async function buildBinaryDeploySnapshot(sessionId?: string | null) {
  const manifest = readAgentManifest();
  const agents = await prisma.agent.findMany({
    orderBy: { hostname: "asc" },
    select: {
      id: true,
      hostname: true,
      status: true,
      lastSeenAt: true,
      version: true,
      binaryUpgradeInProgress: true,
      binaryUpgradeLastError: true,
      binaryUpgradeForcedBuildId: true,
    },
  });
  const now = Date.now();
  const mapped: DeployAgentRow[] = agents.map((a) => ({
    id: a.id,
    hostname: a.hostname,
    online: isAgentOnline(a.lastSeenAt, a.status, now),
    version: a.version,
    binaryUpgradeInProgress: a.binaryUpgradeInProgress,
    binaryUpgradeLastError: a.binaryUpgradeLastError,
    binaryUpgradeForcedBuildId: a.binaryUpgradeForcedBuildId,
  }));

  if (manifest) {
    supersedeBinaryDeploySessions(manifest.buildId);
  }

  let session =
    getBinaryDeploySession(sessionId) ?? getActiveBinaryDeploySession();

  if (!session && sessionId) {
    session = listBinaryDeploySessions(12).find((s) => s.id === sessionId) ?? null;
  }

  if (
    session &&
    manifest &&
    session.buildId.toLowerCase().trim() !== manifest.buildId.toLowerCase().trim()
  ) {
    session = null;
  }

  if (!session && manifest) {
    const rollout = agentsInActiveRollout(manifest, mapped);
    if (rollout.length) {
      session = ensureBinaryDeploySession({
        buildId: manifest.buildId,
        version: manifest.version,
        targetHostnames: rollout.map((a) => a.hostname),
      });
      if (session.events.length <= 1) {
        appendBinaryDeployEvent({
          sessionId: session.id,
          buildId: manifest.buildId,
          version: manifest.version,
          phase: "info",
          level: "info",
          message: `Recovered deployment view for ${rollout.length} agent(s) (controller build ${manifest.buildId})`,
        });
      }
    }
  }

  if (!session) {
    return { session: null, agents: [] };
  }

  const refreshed = refreshBinaryDeploySessionStatus(session, mapped);
  const targets = new Set(refreshed.targetHostnames);
  const deployAgents = mapped
    .filter((a) => targets.has(a.hostname))
    .map((a) => {
      const deployState = agentDeployState({
        hostname: a.hostname,
        online: a.online,
        version: a.version,
        binaryUpgradeInProgress: a.binaryUpgradeInProgress,
        binaryUpgradeLastError: a.binaryUpgradeLastError,
        binaryUpgradeForcedBuildId: a.binaryUpgradeForcedBuildId,
        targetBuildId: refreshed.buildId,
      });
      return {
        id: a.id,
        hostname: a.hostname,
        online: a.online,
        version: a.version,
        binaryUpgradeInProgress: a.binaryUpgradeInProgress,
        binaryUpgradeLastError: a.binaryUpgradeLastError,
        binaryUpgradeForcedBuildId: a.binaryUpgradeForcedBuildId,
        deployState,
      };
    });

  return {
    session: {
      ...refreshed,
      events: mergeDeployEventLog(refreshed, deployAgents),
    },
    agents: deployAgents,
  };
}

export async function agentsRoutes(app: FastifyInstance) {
  app.get(
    "/",
    { preHandler: requireUser },
    async (_req, reply) => {
      const { data, meta } = await cacheWrap("agents:list", 4, async () => {
        await reconcileAllStaleBinaryUpgrades();
        const agents = await prisma.agent.findMany({
          orderBy: { hostname: "asc" },
          include: {
            credential: { select: { createdAt: true } },
            _count: {
              select: { packages: true, services: true, containers: true, jobs: true },
            },
          },
        });
        const now = Date.now();
        const agentIds = agents.map((a) => a.id);
        const runningJobs = agentIds.length
          ? await prisma.job.findMany({
              where: {
                agentId: { in: agentIds },
                status: "RUNNING",
                type: "PACKAGE_UPGRADE",
              },
              select: { agentId: true },
            })
          : [];
        const upgradeInProgressByAgent = new Set(
          runningJobs.map((j) => j.agentId),
        );

        return agents.map((a) => ({
          ...mapAgentRow(a, now),
          upgradeInProgress: upgradeInProgressByAgent.has(a.id),
        }));
      });
      if (meta.redis) reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      return data;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireUser },
    async (req, reply) => {
      const { data, meta } = await cacheWrap(`agents:${req.params.id}`, 12, async () => {
        const agent = await prisma.agent.findUnique({
          where: { id: req.params.id },
          include: {
            credential: { select: { createdAt: true } },
            _count: {
              select: { packages: true, services: true, containers: true, jobs: true },
            },
          },
        });
        if (!agent) return null;
        const now = Date.now();
        const upgradeInProgress =
          (await prisma.job.findFirst({
            where: {
              agentId: agent.id,
              status: "RUNNING",
              type: "PACKAGE_UPGRADE",
            },
            select: { id: true },
          })) != null;
        return {
          ...mapAgentRow(agent, now),
          upgradeInProgress,
        };
      });
      if (!data) return reply.code(404).send({ error: "not_found" });
      if (meta.redis) reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      return data;
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      const parsed = updateAgentSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_body",
          message: parsed.error.issues[0]?.message ?? "Invalid name",
        });
      }

      const existing = await prisma.agent.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) return reply.code(404).send({ error: "not_found" });

      const agent = await prisma.agent.update({
        where: { id: existing.id },
        data: { hostname: parsed.data.hostname },
        include: {
          credential: { select: { createdAt: true } },
          _count: {
            select: { packages: true, services: true, containers: true, jobs: true },
          },
        },
      });

      await invalidateFleetCaches(agent.id);
      await prisma.auditEvent.create({
        data: {
          actorId: (req.user as { sub: string }).sub,
          action: "agent_renamed",
          meta: {
            agentId: agent.id,
            from: existing.hostname,
            to: agent.hostname,
          },
        },
      });

      const now = Date.now();
      const upgradeInProgress =
        (await prisma.job.findFirst({
          where: {
            agentId: agent.id,
            status: "RUNNING",
            type: "PACKAGE_UPGRADE",
          },
          select: { id: true },
        })) != null;

      return {
        ...mapAgentRow(agent, now),
        upgradeInProgress,
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id/jobs",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      const agent = await prisma.agent.findUnique({
        where: { id: req.params.id },
        select: { id: true, hostname: true },
      });
      if (!agent) return reply.code(404).send({ error: "agent_not_found" });

      const deletable = ["COMPLETED", "FAILED", "CANCELLED"] as const;
      const result = await prisma.job.deleteMany({
        where: {
          agentId: agent.id,
          status: { in: [...deletable] },
        },
      });
      const skipped = await prisma.job.count({
        where: {
          agentId: agent.id,
          status: { notIn: [...deletable] },
        },
      });

      await prisma.auditEvent.create({
        data: {
          actorId: (req.user as { sub: string }).sub,
          action: "agent_jobs_deleted",
          meta: {
            agentId: agent.id,
            hostname: agent.hostname,
            deleted: result.count,
            skipped,
          },
        },
      });
      await invalidateFleetCaches(agent.id);
      return { deleted: result.count, skipped };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      const agent = await prisma.agent.findUnique({
        where: { id: req.params.id },
      });
      if (!agent) return reply.code(404).send({ error: "not_found" });

      disconnectAgent(agent.id);
      await prisma.agent.delete({ where: { id: agent.id } });
      await invalidateFleetCaches(agent.id);
      await prisma.auditEvent.create({
        data: {
          actorId: (req.user as { sub: string }).sub,
          action: "agent_deleted",
          meta: { agentId: agent.id, hostname: agent.hostname },
        },
      });

      return { ok: true };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id/crowdsec",
    { preHandler: requireUser },
    async (req, reply) => {
      const { data, meta } = await cacheWrap(
        `agents:${req.params.id}:crowdsec`,
        20,
        async () => {
          const agent = await prisma.agent.findUnique({
            where: { id: req.params.id },
          });
          if (!agent) return undefined;
          const snap = await prisma.crowdSecSnapshot.findUnique({
            where: { agentId: agent.id },
          });
          return snap ?? null;
        },
      );
      if (data === undefined) return reply.code(404).send({ error: "not_found" });
      if (meta.redis) reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      return data;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id/packages",
    { preHandler: requireUser },
    async (req, reply) => {
      const { data, meta } = await cacheWrap(
        `agents:${req.params.id}:packages`,
        30,
        async () => {
          const agent = await prisma.agent.findUnique({
            where: { id: req.params.id },
          });
          if (!agent) return undefined;
          return prisma.packageRecord.findMany({
            where: { agentId: agent.id },
            orderBy: { name: "asc" },
          });
        },
      );
      if (data === undefined) return reply.code(404).send({ error: "not_found" });
      if (meta.redis) reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      return data;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id/containers",
    { preHandler: requireUser },
    async (req, reply) => {
      const { data, meta } = await cacheWrap(
        `agents:${req.params.id}:containers`,
        30,
        async () => {
          const agent = await prisma.agent.findUnique({
            where: { id: req.params.id },
          });
          if (!agent) return undefined;
          return prisma.containerRecord.findMany({
            where: { agentId: agent.id },
            orderBy: { name: "asc" },
          });
        },
      );
      if (data === undefined) return reply.code(404).send({ error: "not_found" });
      if (meta.redis) reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      return data;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id/applications",
    { preHandler: requireUser },
    async (req, reply) => {
      const { data, meta } = await cacheWrap(
        `agents:${req.params.id}:applications`,
        30,
        async () => {
          const agent = await prisma.agent.findUnique({
            where: { id: req.params.id },
          });
          if (!agent) return undefined;
          const packages = await prisma.packageRecord.findMany({
            where: { agentId: agent.id },
            orderBy: [{ manager: "asc" }, { name: "asc" }],
          });
          const byManager: Record<string, typeof packages> = {};
          for (const p of packages) {
            if (!byManager[p.manager]) byManager[p.manager] = [];
            byManager[p.manager].push(p);
          }
          const outdatedCount = packages.filter((p) => p.updateAvailable).length;
          return {
            total: packages.length,
            outdatedCount,
            managers: Object.keys(byManager).sort(),
            byManager,
          };
        },
      );
      if (data === undefined) return reply.code(404).send({ error: "not_found" });
      if (meta.redis) reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      return data;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id/services",
    { preHandler: requireUser },
    async (req, reply) => {
      const { data, meta } = await cacheWrap(
        `agents:${req.params.id}:services`,
        30,
        async () => {
          const agent = await prisma.agent.findUnique({
            where: { id: req.params.id },
          });
          if (!agent) return undefined;
          return prisma.serviceRecord.findMany({
            where: { agentId: agent.id },
            orderBy: { name: "asc" },
          });
        },
      );
      if (data === undefined) return reply.code(404).send({ error: "not_found" });
      if (meta.redis) reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      return data;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id/cves",
    { preHandler: requireUser },
    async (req, reply) => {
      const { data, meta } = await cacheWrap(
        `agents:${req.params.id}:cves`,
        30,
        async () => {
          const agent = await prisma.agent.findUnique({
            where: { id: req.params.id },
            select: {
              id: true,
              hostname: true,
              cveCount: true,
              cveCriticalCount: true,
              cveHighCount: true,
              lastCveScanAt: true,
            },
          });
          if (!agent) return undefined;
          const findings = await prisma.cveFinding.findMany({
            where: { agentId: agent.id },
            orderBy: [{ severity: "asc" }, { cveId: "asc" }],
          });
          return { agent, findings };
        },
      );
      if (data === undefined) return reply.code(404).send({ error: "not_found" });
      if (meta.redis) reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      return data;
    },
  );

  app.get(
    "/binary-deploy/active",
    { preHandler: requireUser },
    async () => buildBinaryDeploySnapshot(null),
  );

  app.get<{ Params: { sessionId: string } }>(
    "/binary-deploy/:sessionId",
    { preHandler: requireUser },
    async (req, reply) => {
      const snapshot = await buildBinaryDeploySnapshot(req.params.sessionId);
      if (!snapshot.session) {
        return reply.code(404).send({ error: "not_found" });
      }
      return snapshot;
    },
  );

  app.get(
    "/agent-release",
    { preHandler: requireUser },
    async () => {
      const manifest = readAgentManifest();
      if (!manifest) {
        return { built: false, hint: "Run scripts/rebuild-fleet-agent.sh on the controller." };
      }
      return { built: true, manifest };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/kernel-maintenance",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      const agent = await prisma.agent.findUnique({
        where: { id: req.params.id },
        select: { id: true, hostname: true, osType: true, status: true, lastSeenAt: true },
      });
      if (!agent) return reply.code(404).send({ error: "agent_not_found" });
      if (agent.osType !== "linux") {
        return reply.code(400).send({ error: "unsupported_os", hint: "Linux only" });
      }
      if (!isAgentOnline(agent.lastSeenAt, agent.status)) {
        return reply.code(409).send({ error: "agent_offline" });
      }

      const inFlightPatch = await prisma.patchPlan.findFirst({
        where: {
          agentId: agent.id,
          status: { in: ["PENDING_DRY_RUN", "APPROVED"] },
        },
        select: { id: true },
      });
      if (inFlightPatch) {
        return reply.code(409).send({
          error: "patch_in_progress",
          planId: inFlightPatch.id,
        });
      }

      const existing = await prisma.job.findFirst({
        where: {
          agentId: agent.id,
          type: "HOST_KERNEL_MAINTENANCE",
          status: { in: ["QUEUED", "RUNNING"] },
        },
        select: { id: true },
      });
      if (existing) {
        return reply.code(409).send({ error: "kernel_maintenance_in_progress", jobId: existing.id });
      }

      const job = await prisma.job.create({
        data: {
          agentId: agent.id,
          type: "HOST_KERNEL_MAINTENANCE" as JobType,
          payload: { rebootDelaySec: 5 },
          status: "QUEUED",
        },
      });

      const actorId = (req.user as { sub: string }).sub;
      await prisma.auditEvent.create({
        data: {
          actorId,
          action: "host_kernel_maintenance",
          meta: { agentId: agent.id, jobId: job.id, hostname: agent.hostname },
        },
      });

      notifyAgent(agent.id, { type: "poll_commands" });
      await invalidateFleetCaches(agent.id);
      return { jobId: job.id, job };
    },
  );

  app.post(
    "/push-binary-update",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      const manifest = readAgentManifest();
      if (!manifest) {
        return reply.code(503).send({
          error: "binary_not_built",
          hint: "Run scripts/rebuild-fleet-agent.sh on the controller first.",
        });
      }
      // Reset stale flags from a previous rollout so the deploy console and reconcile
      // logic do not treat old errors as an instant failure for this push.
      const now = Date.now();
      const allAgents = await prisma.agent.findMany({
        select: {
          id: true,
          hostname: true,
          status: true,
          lastSeenAt: true,
          version: true,
        },
      });
      const onlineAgents = allAgents.filter((a) =>
        isAgentOnline(a.lastSeenAt, a.status, now),
      );

      await prisma.agent.updateMany({
        where: { id: { in: onlineAgents.map((a) => a.id) } },
        data: {
          binaryUpgradeForcedBuildId: manifest.buildId,
          binaryUpgradeInProgress: false,
          binaryUpgradeStartedAt: null,
          binaryUpgradeLastError: null,
        },
      });
      await reconcileAllStaleBinaryUpgrades();

      const agents = onlineAgents;

      const actorId = (req.user as { sub?: string } | undefined)?.sub ?? null;
      supersedeBinaryDeploySessions(manifest.buildId);
      const session = startBinaryDeploySession({
        buildId: manifest.buildId,
        version: manifest.version,
        startedBy: actorId,
        targetHostnames: agents.map((a) => a.hostname),
      });

      appendBinaryDeployEvent({
        sessionId: session.id,
        buildId: manifest.buildId,
        phase: "notify",
        level: "info",
        message: `Notifying ${agents.length} online agent(s) via websocket and heartbeat`,
      });

      for (const agent of agents) {
        notifyAgent(agent.id, { type: "upgrade_binary", buildId: manifest.buildId });
        appendBinaryDeployEvent({
          sessionId: session.id,
          buildId: manifest.buildId,
          agentId: agent.id,
          hostname: agent.hostname,
          phase: "notify",
          level: "info",
          message: `Push sent to ${agent.hostname}`,
        });
      }
      return {
        sessionId: session.id,
        notified: agents.length,
        buildId: manifest.buildId,
        version: manifest.version,
        hosts: agents.map((a) => a.hostname),
      };
    },
  );
}
