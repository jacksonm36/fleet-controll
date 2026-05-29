import { prisma } from "@fleet/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cacheWrap, invalidateFleetCaches } from "../lib/cache.js";
import { notifyAgent } from "../lib/agent-sockets.js";
import { assertOperator, requireUser } from "../middleware/auth.js";

export async function crowdsecRoutes(app: FastifyInstance) {
  app.get(
    "/status",
    { preHandler: requireUser },
    async (_req, reply) => {
      const { data, meta } = await cacheWrap("crowdsec:status", 15, async () => {
        const snaps = await prisma.crowdSecSnapshot.findMany({
          include: { agent: { select: { id: true, hostname: true } } },
        });
        let healthyHosts = 0;
        let alertTotal = 0;
        let decisionTotal = 0;
        for (const s of snaps) {
          const p = s.payload as Record<string, unknown>;
          if (p.healthy === true) healthyHosts++;
          const alerts = p.alerts as unknown[] | undefined;
          const decisions = p.decisions as unknown[] | undefined;
          alertTotal += alerts?.length ?? 0;
          decisionTotal += decisions?.length ?? 0;
        }
        return {
          snapshotHosts: snaps.length,
          healthyHosts,
          alertTotal,
          decisionTotal,
        };
      });
      if (meta.redis) reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      return data;
    },
  );

  app.get(
    "/alerts",
    { preHandler: requireUser },
    async (_req, reply) => {
      const { data, meta } = await cacheWrap("crowdsec:alerts", 30, async () => {
        const snaps = await prisma.crowdSecSnapshot.findMany({
          include: { agent: { select: { id: true, hostname: true } } },
        });
        const rows: Record<string, unknown>[] = [];
        for (const s of snaps) {
          const p = s.payload as Record<string, unknown>;
          const alerts = (p.alerts as Record<string, unknown>[]) ?? [];
          for (const a of alerts) {
            rows.push({
              agentId: s.agentId,
              hostname: s.agent.hostname,
              capturedAt: s.capturedAt,
              alert: a,
            });
          }
        }
        rows.sort((a, b) =>
          String(b.capturedAt).localeCompare(String(a.capturedAt)),
        );
        return rows.slice(0, 500);
      });
      if (meta.redis) reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      return data;
    },
  );

  app.get(
    "/decisions",
    { preHandler: requireUser },
    async (_req, reply) => {
      const { data, meta } = await cacheWrap("crowdsec:decisions", 30, async () => {
        const snaps = await prisma.crowdSecSnapshot.findMany({
          include: { agent: { select: { id: true, hostname: true } } },
        });
        const rows: Record<string, unknown>[] = [];
        for (const s of snaps) {
          const p = s.payload as Record<string, unknown>;
          const decisions =
            (p.decisions as Record<string, unknown>[]) ?? [];
          for (const d of decisions) {
            rows.push({
              agentId: s.agentId,
              hostname: s.agent.hostname,
              capturedAt: s.capturedAt,
              decision: d,
            });
          }
        }
        return rows.slice(0, 500);
      });
      if (meta.redis) reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      return data;
    },
  );

  app.post(
    "/decisions",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      const schema = z.object({
        agentId: z.string(),
        ip: z.string().min(3),
        duration: z.string().optional(),
        reason: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
      const { agentId, ip, duration, reason } = parsed.data;
      const agent = await prisma.agent.findUnique({ where: { id: agentId } });
      if (!agent) return reply.code(404).send({ error: "agent_not_found" });

      const job = await prisma.job.create({
        data: {
          agentId,
          type: "CROWDSEC_DECISION_ADD",
          payload: { ip, duration, reason },
          status: "QUEUED",
        },
      });
      await prisma.auditEvent.create({
        data: {
          actorId: (req.user as { sub: string }).sub,
          action: "crowdsec_decision_job",
          meta: { jobId: job.id, agentId, ip },
        },
      });
      notifyAgent(agentId, { type: "pending_job", jobId: job.id });
      await invalidateFleetCaches(agentId);
      return job;
    },
  );
}
