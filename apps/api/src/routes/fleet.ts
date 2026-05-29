import { prisma } from "@fleet/db";
import type { FastifyInstance } from "fastify";
import { cacheWrap } from "../lib/cache.js";
import {
  isAgentOnline,
  isMetricsStale,
  onlineThresholdDate,
} from "../lib/agent-presence.js";
import {
  fleetAutoEncrypt,
  fleetPublicHost,
  fleetRequireTls,
} from "../lib/env.js";
import {
  fleetCaCertPath,
  fleetCaDownloadUrl,
  fleetTlsProxy,
  secureCentralApiUrl,
  securePublicBase,
} from "../lib/fleet-urls.js";
import { requireUser } from "../middleware/auth.js";

export async function fleetRoutes(app: FastifyInstance) {
  app.get(
    "/summary",
    { preHandler: requireUser },
    async (_req, reply) => {
      const { data, meta } = await cacheWrap("fleet:summary", 4, async () => {
        const threshold = onlineThresholdDate();
        const [
          agentCount,
          onlineCount,
          rebootRequiredCount,
          kernelUpdatePendingCount,
          packageUpdatesPendingSum,
          outdatedPackagesCount,
          cveCount,
          cveCriticalCount,
          cveHighCount,
          agentsWithCves,
          crowdsecHosts,
          pendingJobs,
          packagesTracked,
        ] = await Promise.all([
          prisma.agent.count(),
          prisma.agent.count({
            where: { status: "ONLINE", lastSeenAt: { gte: threshold } },
          }),
          prisma.agent.count({ where: { rebootRequired: true } }),
          prisma.agent.count({ where: { kernelUpdatePending: true } }),
          prisma.agent.aggregate({ _sum: { packageUpdatesPending: true } }),
          prisma.packageRecord.count({ where: { updateAvailable: true } }),
          prisma.cveFinding.count(),
          prisma.cveFinding.count({ where: { severity: "CRITICAL" } }),
          prisma.cveFinding.count({ where: { severity: "HIGH" } }),
          prisma.agent.count({ where: { cveCount: { gt: 0 } } }),
          prisma.agent.count({ where: { crowdsecInstalled: true } }),
          prisma.job.count({
            where: { status: { in: ["QUEUED", "RUNNING"] } },
          }),
          prisma.packageRecord.count(),
        ]);

        return {
          agentCount,
          onlineCount,
          staleCount: agentCount - onlineCount,
          pendingJobs,
          packagesTracked,
          rebootRequiredCount,
          kernelUpdatePendingCount,
          packageUpdatesPendingCount:
            packageUpdatesPendingSum._sum.packageUpdatesPending ?? 0,
          outdatedPackagesCount,
          cveCount,
          cveCriticalCount,
          cveHighCount,
          agentsWithCves,
          crowdsecHosts,
        };
      });

      if (meta.redis) {
        reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      }
      return data;
    },
  );

  app.get(
    "/cves",
    { preHandler: requireUser },
    async (req, reply) => {
      const severity = (req.query as { severity?: string }).severity;
      const { data, meta } = await cacheWrap("fleet:cves", 15, async () => {
        const now = Date.now();
        const findings = await prisma.cveFinding.findMany({
          where: severity
            ? { severity: severity as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" }
            : undefined,
          orderBy: [{ severity: "asc" }, { cveId: "asc" }],
          take: 500,
          include: {
            agent: {
              select: {
                id: true,
                hostname: true,
                osType: true,
                lastSeenAt: true,
                status: true,
              },
            },
          },
        });
        return findings.map((f) => ({
          ...f,
          agent: {
            id: f.agent.id,
            hostname: f.agent.hostname,
            osType: f.agent.osType,
            online: isAgentOnline(
              f.agent.lastSeenAt,
              f.agent.status,
              now,
            ),
          },
        }));
      });
      if (meta.redis) reply.header("X-Cache", meta.hit ? "HIT" : "MISS");
      return data;
    },
  );

  app.get(
    "/tls-setup",
    { preHandler: requireUser },
    async (req, reply) => {
      const apiPort = Number(process.env.API_PORT ?? 4000);
      const publicUrl = securePublicBase(req, apiPort);
      const caUrl = fleetCaDownloadUrl(req, apiPort);
      return {
        tlsRequired: fleetRequireTls(),
        autoEncrypt: fleetAutoEncrypt(),
        publicUrl,
        caAvailable: !!fleetCaCertPath(),
        caDownloadUrl: caUrl ?? `${publicUrl}/api/public/tls-ca.crt`,
        controllerHost: fleetPublicHost() ?? secureCentralApiUrl(req, apiPort).replace(
          /^https?:\/\//,
          "",
        ).replace(/:\d+$/, ""),
        tlsProxy: fleetTlsProxy(),
        sslCertPath: process.env.FLEET_SSL_CERT?.trim() || "/etc/fleet/ssl/fullchain.pem",
        sslKeyPath: process.env.FLEET_SSL_KEY?.trim() || "/etc/fleet/ssl/privkey.pem",
        issuer: "Fleet TLS (nginx ssl_certificate)",
        trustProxy: process.env.TRUST_PROXY === "1",
      };
    },
  );
}
