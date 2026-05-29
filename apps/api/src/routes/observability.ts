import { prisma } from "@fleet/db";
import type { FastifyInstance } from "fastify";
import {
  grafanaAgentDashboardUrl,
  grafanaPublicUrl,
  influxConfigured,
  queryAgentMetricsHistory,
  type MetricHistoryRange,
} from "../lib/influx.js";
import {
  grafanaExploreLogsUrl,
  LOGQL_FLEET_CONTROLLER,
  logqlFleetAgent,
  logqlForHostname,
  lokiConfigured,
  agentHasJournalInLoki,
  listLokiJournalHostnames,
  queryLokiRange,
} from "../lib/loki.js";
import { isAgentOnline, isMetricsStale } from "../lib/agent-presence.js";
import { requireUser } from "../middleware/auth.js";

const historyRanges = new Set<MetricHistoryRange>(["1h", "6h", "24h"]);
const logSources = new Set(["host", "fleet-agent", "controller", "jobs"]);

const agentMetricsSelect = {
  id: true,
  hostname: true,
  osType: true,
  status: true,
  lastSeenAt: true,
  lastMetricsAt: true,
  cpuPercent: true,
  memUsedPercent: true,
  load1: true,
  networkRxBps: true,
  networkTxBps: true,
  diskRootUsedPercent: true,
  loggedInUsers: true,
  healthScore: true,
  healthStatus: true,
  rebootRequired: true,
  packageUpdatesPending: true,
  cveCount: true,
} as const;

const agentContextSelect = {
  osDetail: true,
  version: true,
  enrolledAt: true,
  labels: true,
  crowdsecInstalled: true,
  kernelRunning: true,
  kernelInstalled: true,
  kernelUpdatePending: true,
  cveCriticalCount: true,
  cveHighCount: true,
  lastCveScanAt: true,
  ...agentMetricsSelect,
} as const;

function mapAgentMetrics(
  agents: Awaited<ReturnType<typeof prisma.agent.findMany>>,
) {
  const now = Date.now();
  return agents.map((a) => ({
    ...a,
    lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
    lastMetricsAt: a.lastMetricsAt?.toISOString() ?? null,
    online: isAgentOnline(a.lastSeenAt, a.status, now),
    metricsStale: isMetricsStale(a.lastMetricsAt, now),
  }));
}

function observabilityConfig() {
  return {
    influxConfigured: influxConfigured(),
    lokiConfigured: lokiConfigured(),
    grafanaUrl: grafanaPublicUrl(),
    lokiUrl: process.env.LOKI_URL?.trim() || "http://127.0.0.1:3100",
    metricsIntervalSec: 20,
  };
}

async function loadAgentContext(agentId: string) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      ...agentContextSelect,
      _count: {
        select: {
          packages: true,
          services: true,
          containers: true,
          jobs: true,
          cveFindings: true,
          patchPlans: true,
        },
      },
    },
  });
  if (!agent) return null;

  const [recentJobs, recentPatchRuns, topCves, failedServices, runningContainers] =
    await Promise.all([
      prisma.job.findMany({
        where: { agentId },
        orderBy: { createdAt: "desc" },
        take: 15,
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          finishedAt: true,
          errorMessage: true,
        },
      }),
      prisma.patchRun.findMany({
        where: { agentId },
        orderBy: { startedAt: "desc" },
        take: 10,
        select: {
          id: true,
          manager: true,
          packageCount: true,
          exitStatus: true,
          startedAt: true,
          finishedAt: true,
        },
      }),
      prisma.cveFinding.findMany({
        where: { agentId },
        orderBy: [{ severity: "asc" }, { cveId: "asc" }],
        take: 12,
        select: {
          id: true,
          cveId: true,
          severity: true,
          packageName: true,
          summary: true,
        },
      }),
      prisma.serviceRecord.findMany({
        where: { agentId, state: { not: "running" } },
        orderBy: { name: "asc" },
        take: 8,
        select: { name: true, kind: true, state: true, enabled: true },
      }),
      prisma.containerRecord.findMany({
        where: { agentId },
        orderBy: { name: "asc" },
        take: 8,
        select: {
          name: true,
          image: true,
          runtime: true,
          status: true,
        },
      }),
    ]);

  const outdatedPackages = await prisma.packageRecord.count({
    where: { agentId, updateAvailable: true },
  });

  const { _count, ...rest } = agent;
  const now = Date.now();
  return {
    agent: {
      ...rest,
      enrolledAt: rest.enrolledAt.toISOString(),
      lastSeenAt: rest.lastSeenAt?.toISOString() ?? null,
      lastMetricsAt: rest.lastMetricsAt?.toISOString() ?? null,
      lastCveScanAt: rest.lastCveScanAt?.toISOString() ?? null,
      online: isAgentOnline(rest.lastSeenAt, rest.status, now),
      metricsStale: isMetricsStale(rest.lastMetricsAt, now),
    },
    counts: { ..._count, outdatedPackages },
    recentJobs: recentJobs.map((j) => ({
      ...j,
      createdAt: j.createdAt.toISOString(),
      finishedAt: j.finishedAt?.toISOString() ?? null,
    })),
    recentPatchRuns: recentPatchRuns.map((r) => ({
      ...r,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
    topCves,
    failedServices,
    runningContainers,
  };
}

export async function observabilityRoutes(app: FastifyInstance) {
  app.get(
    "/config",
    { preHandler: requireUser },
    async () => observabilityConfig(),
  );

  app.get(
    "/dashboard",
    { preHandler: requireUser },
    async (_req, reply) => {
      const agents = await prisma.agent.findMany({
        orderBy: { hostname: "asc" },
        select: agentMetricsSelect,
      });
      reply.header("Cache-Control", "private, max-age=3");
      return {
        config: observabilityConfig(),
        hosts: mapAgentMetrics(agents),
      };
    },
  );

  app.get(
    "/hosts",
    { preHandler: requireUser },
    async (_req, reply) => {
      const agents = await prisma.agent.findMany({
        orderBy: { hostname: "asc" },
        select: agentMetricsSelect,
      });
      reply.header("Cache-Control", "private, max-age=3");
      return mapAgentMetrics(agents);
    },
  );

  app.get<{ Params: { agentId: string }; Querystring: { range?: string } }>(
    "/agents/:agentId",
    { preHandler: requireUser },
    async (req, reply) => {
      const { agentId } = req.params;
      const rangeRaw = req.query.range?.trim() ?? "1h";
      const range: MetricHistoryRange = historyRanges.has(
        rangeRaw as MetricHistoryRange,
      )
        ? (rangeRaw as MetricHistoryRange)
        : "1h";

      const ctx = await loadAgentContext(agentId);
      if (!ctx) {
        return reply.code(404).send({ error: "not_found" });
      }

      const host = {
        id: ctx.agent.id,
        hostname: ctx.agent.hostname,
        osType: ctx.agent.osType,
        status: ctx.agent.status,
        online: ctx.agent.online,
        metricsStale: ctx.agent.metricsStale,
        lastSeenAt: ctx.agent.lastSeenAt,
        lastMetricsAt: ctx.agent.lastMetricsAt,
        cpuPercent: ctx.agent.cpuPercent,
        memUsedPercent: ctx.agent.memUsedPercent,
        load1: ctx.agent.load1,
        networkRxBps: ctx.agent.networkRxBps,
        networkTxBps: ctx.agent.networkTxBps,
        diskRootUsedPercent: ctx.agent.diskRootUsedPercent,
        loggedInUsers: ctx.agent.loggedInUsers,
        healthScore: ctx.agent.healthScore,
        healthStatus: ctx.agent.healthStatus,
        rebootRequired: ctx.agent.rebootRequired,
        packageUpdatesPending: ctx.agent.packageUpdatesPending,
        cveCount: ctx.agent.cveCount,
      };
      let history: Awaited<ReturnType<typeof queryAgentMetricsHistory>> = null;
      let historyError: string | null = null;
      if (influxConfigured()) {
        try {
          history = await queryAgentMetricsHistory(agentId, range);
        } catch (err) {
          req.log.warn({ err, agentId }, "InfluxDB history query failed");
          historyError =
            err instanceof Error ? err.message : "history_query_failed";
        }
      }

      reply.header("Cache-Control", "private, max-age=3");
      return {
        config: observabilityConfig(),
        host,
        context: ctx,
        range,
        history: history ?? {},
        historyAvailable:
          !!history &&
          Object.values(history).some((pts) => pts && pts.length > 0),
        historyError,
        grafanaAgentUrl: grafanaAgentDashboardUrl(
          agentId,
          ctx.agent.hostname,
        ),
        grafanaLogsUrl: grafanaExploreLogsUrl(ctx.agent.hostname),
      };
    },
  );

  app.get<{
    Params: { agentId: string };
    Querystring: { range?: string; source?: string };
  }>(
    "/agents/:agentId/logs",
    { preHandler: requireUser },
    async (req, reply) => {
      const { agentId } = req.params;
      const rangeRaw = req.query.range?.trim() ?? "1h";
      const range: MetricHistoryRange = historyRanges.has(
        rangeRaw as MetricHistoryRange,
      )
        ? (rangeRaw as MetricHistoryRange)
        : "1h";
      const sourceRaw = req.query.source?.trim() ?? "jobs";
      const source = logSources.has(sourceRaw) ? sourceRaw : "jobs";

      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { hostname: true },
      });
      if (!agent) {
        return reply.code(404).send({ error: "not_found" });
      }

      const lokiHosts = await listLokiJournalHostnames();
      const journalOnThisLoki = lokiHosts.includes(agent.hostname);

      if (source === "jobs") {
        const since = new Date(
          Date.now() -
            (range === "24h" ? 24 : range === "6h" ? 6 : 1) * 60 * 60 * 1000,
        );
        const jobs = await prisma.job.findMany({
          where: { agentId, createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            type: true,
            status: true,
            createdAt: true,
            logs: { orderBy: { seq: "asc" }, take: 200 },
          },
        });
        const lines = jobs.flatMap((job) =>
          job.logs.map((chunk) => ({
            ts: chunk.createdAt.toISOString(),
            line: `[${job.type} · ${job.status}] ${chunk.message}`,
            labels: {
              job_id: job.id,
              job_type: job.type,
              source: "fleet_job",
            },
          })),
        );
        lines.sort((a, b) => b.ts.localeCompare(a.ts));
        reply.header("Cache-Control", "private, max-age=5");
        return {
          lines: lines.slice(0, 500),
          query: "Fleet job log chunks (PostgreSQL)",
          alternateQueries: [],
          lokiConfigured: lokiConfigured(),
          logsError: null,
          grafanaExploreUrl: grafanaExploreLogsUrl(agent.hostname),
          hint:
            lines.length === 0
              ? "No job output stored yet. Run automation or patch jobs on this host — logs appear here when jobs complete."
              : "Job stdout/stderr from Fleet automation runs (stored in the database). For systemd journal lines use Loki sources once Promtail is shipping.",
          source: "jobs",
        };
      }

      if ((source === "host" || source === "fleet-agent") && !journalOnThisLoki) {
        reply.header("Cache-Control", "private, max-age=5");
        return {
          lines: [],
          query:
            source === "fleet-agent"
              ? logqlFleetAgent(agent.hostname)
              : logqlForHostname(agent.hostname),
          alternateQueries: [LOGQL_FLEET_CONTROLLER],
          lokiConfigured: lokiConfigured(),
          logsError: null,
          grafanaExploreUrl: grafanaExploreLogsUrl(agent.hostname),
          journalOnThisLoki: false,
          lokiHostnames: lokiHosts,
          hint: `Agent "${agent.hostname}" is not this controller (Loki journal hostnames: ${lokiHosts.join(", ") || "none"}). The fleet-agent process runs on the agent machine — use Job logs for command output, or install Promtail on ${agent.hostname}. Controller fleet shows API/web logs from this server.`,
          source,
        };
      }

      let query = logqlForHostname(agent.hostname);
      if (source === "fleet-agent") {
        query = logqlFleetAgent(agent.hostname);
      } else if (source === "controller") {
        query = LOGQL_FLEET_CONTROLLER;
      }

      let lines: Awaited<ReturnType<typeof queryLokiRange>> = [];
      let logsError: string | null = null;
      if (lokiConfigured()) {
        try {
          lines = await queryLokiRange(query, range, 400);
        } catch (err) {
          req.log.warn({ err, agentId }, "Loki query failed");
          logsError = err instanceof Error ? err.message : "loki_query_failed";
        }
      }

      reply.header("Cache-Control", "private, max-age=5");
      return {
        lines,
        query,
        alternateQueries: [
          logqlForHostname(agent.hostname),
          logqlFleetAgent(agent.hostname),
          LOGQL_FLEET_CONTROLLER,
        ],
        lokiConfigured: lokiConfigured(),
        logsError,
        grafanaExploreUrl: grafanaExploreLogsUrl(agent.hostname),
        journalOnThisLoki,
        lokiHostnames: lokiHosts,
        hint:
          lines.length === 0
            ? source === "controller"
              ? "Controller fleet-api / fleet-web journal (this server). Not logs from the agent host."
              : "No lines in this time range. Try a longer window or Job logs."
            : source === "controller"
              ? "Systemd journal from the Fleet controller (API/web). Agent host logs need Promtail on the agent or Job logs here."
              : null,
        source,
      };
    },
  );
}
