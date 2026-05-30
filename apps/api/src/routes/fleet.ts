import { prisma } from "@fleet/db";
import type { AppInstance } from "../types/app-instance.js";
import { cacheWrap } from "../lib/cache.js";
import {
  isAgentOnline,
  onlineThresholdDate,
} from "../lib/agent-presence.js";
import {
  envNumber,
  envString,
  fleetAgentMtlsMode,
  fleetAutoEncrypt,
  fleetPublicHost,
  fleetRequireTls,
  fleetTlsMinVersionForAgents,
  fleetTlsPinAuto,
  resolveTrustProxy,
} from "../lib/env.js";
import { fleetMtlsCaReady } from "../lib/fleet-mtls.js";
import { controllerTlsPinInfo } from "../lib/fleet-tls-pin.js";
import {
  fleetCaCertPath,
  fleetCaDownloadUrl,
  fleetTlsProxy,
  secureCentralApiUrl,
  securePublicBase,
} from "../lib/fleet-urls.js";
import { runSecurityChecks } from "../lib/security-config.js";
import {
  queueTlsRolloutJobs,
  tlsFixScriptForAgent,
} from "../lib/fleet-agent-tls-rollout.js";
import { rejectShellAutomationIfDisabled } from "../lib/automation-guard.js";
import { assertAdmin, assertOperator, requireUser } from "../middleware/auth.js";
import { z } from "zod";

async function listCveFindingsWithAgents(
  severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
) {
  return prisma.cveFinding.findMany({
    where: severity ? { severity } : undefined,
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
}

type CveFindingWithAgent = Awaited<
  ReturnType<typeof listCveFindingsWithAgents>
>[number];

export async function fleetRoutes(app: AppInstance) {
  app.get(
    "/security",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertAdmin(req, reply)) return;
      const checks = runSecurityChecks();
      const critical = checks.filter((c) => c.severity === "critical").length;
      const warning = checks.filter((c) => c.severity === "warning").length;
      return {
        ok: critical === 0,
        critical,
        warning,
        checks,
      };
    },
  );

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
        const findings = await listCveFindingsWithAgents(
          severity as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | undefined,
        );
        return findings.map((f: CveFindingWithAgent) => ({
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
      const apiPort = envNumber("API_PORT", 4000);
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
        sslCertPath: envString("FLEET_SSL_CERT", "/etc/fleet/ssl/fullchain.pem"),
        sslKeyPath: envString("FLEET_SSL_KEY", "/etc/fleet/ssl/privkey.pem"),
        issuer: "Fleet TLS (nginx ssl_certificate)",
        trustProxy: resolveTrustProxy(),
        agentMtls: fleetAgentMtlsMode(),
        agentMtlsCaReady: fleetMtlsCaReady(),
        tlsPinUrl: caUrl
          ? `${publicUrl}/api/public/tls-pin.json`
          : null,
        tlsPinAuto: fleetTlsPinAuto(),
        tlsPin: controllerTlsPinInfo(),
        sessionCiphers: "ChaCha20-Poly1305,AES-GCM (TLS 1.2/1.3)",
        agentTlsMinVersion: fleetTlsMinVersionForAgents(),
        fixAgentScriptUrl: `${publicUrl}/api/public/fix-agent-connection.sh`,
        rolloutHint:
          "POST /api/fleet/rollout-agent-tls queues fix script on online agents; run scripts/rollout-fleet-agent-tls.sh on the controller.",
      };
    },
  );

  app.post(
    "/rollout-agent-tls",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!assertOperator(req, reply)) return;
      if (rejectShellAutomationIfDisabled("SHELL_SCRIPT", reply)) return;

      const parsed = z
        .object({
          queueJobs: z.boolean().optional().default(true),
        })
        .safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }

      const apiPort = envNumber("API_PORT", 4000);
      const publicUrl = securePublicBase(req, apiPort);

      if (!parsed.data.queueJobs) {
        return {
          queued: 0,
          skippedOffline: 0,
          fixScriptUrl: `${publicUrl}/api/public/fix-agent-connection.sh`,
          manualCommand: `curl -fsSL '${publicUrl}/api/public/fix-agent-connection.sh' | bash`,
          sampleScript: tlsFixScriptForAgent(publicUrl),
        };
      }

      const result = await queueTlsRolloutJobs(publicUrl);
      return {
        ...result,
        centralUrl: publicUrl,
        fixScriptUrl: `${publicUrl}/api/public/fix-agent-connection.sh`,
        hint: "Each online agent runs fix-agent-connection.sh (CA, SHA-512 pin, systemd env). Push agent binary separately from Agents page.",
      };
    },
  );
}
