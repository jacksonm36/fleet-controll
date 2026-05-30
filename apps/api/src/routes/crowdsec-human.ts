import { prisma } from "@fleet/db";
import type { AppInstance } from "../types/app-instance.js";
import { z } from "zod";
import { isAgentOnline } from "../lib/agent-presence.js";
import { notifyAgent } from "../lib/agent-sockets.js";
import { cacheWrap, invalidateFleetCaches } from "../lib/cache.js";
import {
  buildCrowdSecStatus,
  countCrowdSecDecisions,
  flattenCrowdSecDecisions,
  type CrowdSecAgentRow,
  parseCrowdSecAlert,
  parseCrowdSecDecision,
  summarizeCrowdSecPayload,
} from "../lib/crowdsec-parse.js";
import { assertOperator, requireUser } from "../middleware/auth.js";

const crowdsecAgentSelect = {
  id: true,
  hostname: true,
  osType: true,
  osDetail: true,
  status: true,
  lastSeenAt: true,
  crowdsecInstalled: true,
  crowdSecSnapshots: {
    select: { payload: true, capturedAt: true },
  },
} as const;

type CrowdSecAgentDbRow = {
  id: string;
  hostname: string;
  osType: string;
  osDetail: string | null;
  status: string;
  lastSeenAt: Date | null;
  crowdsecInstalled: boolean;
  crowdSecSnapshots: { payload: unknown; capturedAt: Date }[];
};

type AgentPresencePick = {
  lastSeenAt: Date | null;
  status: string;
};

export async function crowdsecRoutes(app: AppInstance) {
  app.get(
    "/status",
    { preHandler: requireUser },
    async (_req, reply) => {
      const { data, meta } = await cacheWrap("crowdsec:status", 15, async () => {
        const now = Date.now();
        const [snaps, enrolledAgents, allAgents] = await Promise.all([
          prisma.crowdSecSnapshot.findMany({
            select: { payload: true },
          }),
          prisma.agent.count(),
          prisma.agent.findMany({
            select: { lastSeenAt: true, status: true },
          }),
        ]);
        return buildCrowdSecStatus(
          snaps,
          allAgents.map((a: AgentPresencePick) => ({
            online: isAgentOnline(a.lastSeenAt, a.status, now),
          })),
          enrolledAgents,
        );
      });
      if (meta.redis) reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      return data;
    },
  );

  app.get(
    "/agents",
    { preHandler: requireUser },
    async (_req, reply) => {
      const { data, meta } = await cacheWrap("crowdsec:agents", 15, async () => {
        const now = Date.now();
        const agents = await prisma.agent.findMany({
          orderBy: { hostname: "asc" },
          select: crowdsecAgentSelect,
        });

        const rows = agents.map((a: CrowdSecAgentDbRow) => {
          const snap = a.crowdSecSnapshots[0] ?? null;
          return summarizeCrowdSecPayload(snap?.payload, {
            agentId: a.id,
            hostname: a.hostname,
            osType: a.osType,
            osDetail: a.osDetail,
            online: isAgentOnline(a.lastSeenAt, a.status, now),
            crowdsecInstalled: a.crowdsecInstalled,
            capturedAt: snap?.capturedAt ?? null,
            lastSeenAt: a.lastSeenAt,
          });
        });

        const reporting = rows.filter((r: CrowdSecAgentRow) => r.reporting);
        const notReporting = rows.filter((r: CrowdSecAgentRow) => !r.reporting);

        return {
          agents: rows,
          reportingCount: reporting.length,
          notReportingCount: notReporting.length,
        };
      });
      if (meta.redis) reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      return data;
    },
  );

  app.get(
    "/alerts",
    { preHandler: requireUser },
    async (req, reply) => {
      const hostFilter = String((req.query as { host?: string }).host ?? "")
        .trim()
        .toLowerCase();

      const { data, meta } = await cacheWrap(
        hostFilter ? `crowdsec:alerts:${hostFilter}` : "crowdsec:alerts",
        30,
        async () => {
          const snaps = await prisma.crowdSecSnapshot.findMany({
            include: { agent: { select: { id: true, hostname: true } } },
          });
          const rows = [];
          for (const s of snaps) {
            if (
              hostFilter &&
              !s.agent.hostname.toLowerCase().includes(hostFilter)
            ) {
              continue;
            }
            const p = s.payload as Record<string, unknown>;
            const alerts = (p.alerts as unknown[]) ?? [];
            for (const a of alerts) {
              rows.push(
                parseCrowdSecAlert(a, {
                  agentId: s.agentId,
                  hostname: s.agent.hostname,
                  capturedAt: s.capturedAt,
                }),
              );
            }
          }
          rows.sort((a, b) => {
            const ta = a.alertAt ?? a.capturedAt;
            const tb = b.alertAt ?? b.capturedAt;
            return tb.localeCompare(ta);
          });
          return rows.slice(0, 500);
        },
      );
      if (meta.redis) reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      return data;
    },
  );

  app.get(
    "/decisions",
    { preHandler: requireUser },
    async (req, reply) => {
      const hostFilter = String((req.query as { host?: string }).host ?? "")
        .trim()
        .toLowerCase();

      const { data, meta } = await cacheWrap(
        hostFilter ? `crowdsec:decisions:${hostFilter}` : "crowdsec:decisions",
        30,
        async () => {
          const snaps = await prisma.crowdSecSnapshot.findMany({
            include: { agent: { select: { id: true, hostname: true } } },
          });
          const rows = [];
          for (const s of snaps) {
            if (
              hostFilter &&
              !s.agent.hostname.toLowerCase().includes(hostFilter)
            ) {
              continue;
            }
            const p = s.payload as Record<string, unknown>;
            const decisions = flattenCrowdSecDecisions(p.decisions);
            for (const d of decisions) {
              rows.push(
                parseCrowdSecDecision(d, {
                  agentId: s.agentId,
                  hostname: s.agent.hostname,
                  capturedAt: s.capturedAt,
                }),
              );
            }
          }
          return rows.slice(0, 500);
        },
      );
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
