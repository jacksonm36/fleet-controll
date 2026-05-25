import { prisma } from "@fleet/db";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../middleware/auth.js";

export async function fleetRoutes(app: FastifyInstance) {
  app.get(
    "/summary",
    { preHandler: requireUser },
    async () => {
      const threshold = new Date(Date.now() - 120_000);
      const [
        agentCount,
        onlineCount,
        rebootRequiredCount,
        crowdsecHosts,
        pendingJobs,
        packagesTracked,
      ] = await Promise.all([
        prisma.agent.count(),
        prisma.agent.count({
          where: { status: "ONLINE", lastSeenAt: { gte: threshold } },
        }),
        prisma.agent.count({ where: { rebootRequired: true } }),
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
        crowdsecHosts,
      };
    },
  );
}
