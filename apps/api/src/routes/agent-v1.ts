import { prisma } from "@fleet/db";
import type { JobStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomAgentToken, sha256Hex } from "../lib/crypto.js";
import { emitJobLog } from "../lib/job-bus.js";
import { requireAgent } from "../middleware/agent-auth.js";

const enrollSchema = z.object({
  token: z.string().min(8),
  hostname: z.string().min(1),
  // Agents send runtime.OS (darwin on macOS). Stored as opaque string on Agent.
  osType: z.enum(["linux", "windows", "darwin"]),
  osDetail: z.string().optional(),
  version: z.string().optional(),
});

const inventorySchema = z.object({
  schemaVersion: z.literal(1),
  collectedAt: z.string(),
  packages: z.array(
    z.object({
      name: z.string(),
      version: z.string(),
      manager: z.string(),
      source: z.string().optional(),
    }),
  ),
  services: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["systemd", "windows_service"]),
      state: z.string(),
      enabled: z.boolean().optional(),
    }),
  ),
  rebootRequired: z.boolean().optional(),
  crowdsecInstalled: z.boolean().optional(),
});

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
  app.post("/enroll", async (req, reply) => {
    const parsed = enrollSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const { token, hostname, osType, osDetail, version } = parsed.data;
    const tokenHash = sha256Hex(token);
    const et = await prisma.enrollmentToken.findFirst({
      where: { tokenHash, expiresAt: { gt: new Date() } },
    });
    if (!et) return reply.code(400).send({ error: "invalid_or_expired_token" });

    await prisma.enrollmentToken.delete({ where: { id: et.id } });

    const plainApiToken = randomAgentToken();
    const secretHash = sha256Hex(plainApiToken);

    const agent = await prisma.agent.create({
      data: {
        hostname,
        osType,
        osDetail,
        version,
        status: "OFFLINE",
        rebootRequired: false,
        crowdsecInstalled: false,
      },
    });

    await prisma.agentCredential.create({
      data: { agentId: agent.id, secretHash },
    });

    await prisma.auditEvent.create({
      data: {
        action: "agent_enrolled",
        meta: { agentId: agent.id, hostname },
      },
    });

    return {
      agentId: agent.id,
      apiToken: plainApiToken,
    };
  });

  app.post(
    "/heartbeat",
    { preHandler: requireAgent },
    async (req, reply) => {
      const agentId = req.agentCtx!.agentId;
      const bodySchema = z.object({ version: z.string().optional() });
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

      await prisma.agent.update({
        where: { id: agentId },
        data: {
          lastSeenAt: new Date(),
          status: "ONLINE",
          ...(parsed.data.version ? { version: parsed.data.version } : {}),
        },
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
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
      const inv = parsed.data;

      await prisma.$transaction(async (tx) => {
        await tx.packageRecord.deleteMany({ where: { agentId } });
        await tx.serviceRecord.deleteMany({ where: { agentId } });
        if (inv.packages.length) {
          await tx.packageRecord.createMany({
            data: inv.packages.map((p) => ({
              agentId,
              name: p.name,
              version: p.version,
              manager: p.manager,
              source: p.source,
            })),
          });
        }
        if (inv.services.length) {
          await tx.serviceRecord.createMany({
            data: inv.services.map((s) => ({
              agentId,
              name: s.name,
              kind: s.kind === "systemd" ? "systemd" : "windows_service",
              state: s.state,
              enabled: s.enabled ?? null,
            })),
          });
        }
        await tx.agent.update({
          where: { id: agentId },
          data: {
            rebootRequired: inv.rebootRequired ?? false,
            crowdsecInstalled: inv.crowdsecInstalled ?? false,
            lastSeenAt: new Date(),
            status: "ONLINE",
          },
        });
      });

      return { ok: true, received: inv.packages.length };
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

      return { ok: true };
    },
  );

  app.get(
    "/commands",
    { preHandler: requireAgent },
    async (req, reply) => {
      const agentId = req.agentCtx!.agentId;
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
        const pollMs = Number(process.env.AGENT_JOB_POLL_MS ?? 1200);
        await new Promise((r) => setTimeout(r, pollMs));
      }
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
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

      const job = await prisma.job.findUnique({
        where: { id: req.params.jobId },
      });
      if (!job || job.agentId !== agentId) {
        return reply.code(404).send({ error: "not_found" });
      }

      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: parsed.data.status as JobStatus,
          finishedAt: new Date(),
          errorMessage: parsed.data.errorMessage,
        },
      });

      return { ok: true };
    },
  );
}
