import { prisma } from "@fleet/db";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../middleware/auth.js";

export async function fleetRoutes(app: FastifyInstance) {
  app.get(
    "/summary",
    { preHandler: requireUser },
    async () => {
      const now = Date.now();
      const threshold = now - 120_000;
      const agents = await prisma.agent.findMany({
        select: {
          id: true,
          lastSeenAt: true,
          status: true,
          rebootRequired: true,
          crowdsecInstalled: true,
        },
      });
      const agentCount = agents.length;
      let onlineCount = 0;
      let staleCount = 0;
      let rebootRequiredCount = 0;
      let crowdsecHosts = 0;
      for (const a of agents) {
        const seen = a.lastSeenAt?.getTime() ?? 0;
        const online =
          seen >= threshold && a.status === "ONLINE";
        if (online) onlineCount++;
        else staleCount++;
        if (a.rebootRequired) rebootRequiredCount++;
        if (a.crowdsecInstalled) crowdsecHosts++;
      }

      const pendingJobs = await prisma.job.count({
        where: { status: { in: ["QUEUED", "RUNNING"] } },
      });

      const packagesTracked = await prisma.packageRecord.count();

      return {
        agentCount,
        onlineCount,
        staleCount,
        pendingJobs,
        packagesTracked,
        rebootRequiredCount,
        crowdsecHosts,
      };
    },
  );
}
