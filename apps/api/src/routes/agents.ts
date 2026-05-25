import { prisma } from "@fleet/db";
import type { FastifyInstance } from "fastify";
import { assertOperator, requireUser } from "../middleware/auth.js";
import { disconnectAgent } from "../lib/agent-sockets.js";

export async function agentsRoutes(app: FastifyInstance) {
  app.get(
    "/",
    { preHandler: requireUser },
    async () => {
      const agents = await prisma.agent.findMany({
        orderBy: { hostname: "asc" },
        include: {
          _count: { select: { packages: true, services: true, jobs: true } },
        },
      });
      const threshold = Date.now() - 120_000;
      return agents.map((a) => ({
        ...a,
        online:
          !!a.lastSeenAt && a.lastSeenAt.getTime() >= threshold && a.status === "ONLINE",
      }));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireUser },
    async (req, reply) => {
      const agent = await prisma.agent.findUnique({
        where: { id: req.params.id },
        include: {
          _count: { select: { packages: true, services: true, jobs: true } },
        },
      });
      if (!agent) return reply.code(404).send({ error: "not_found" });
      const threshold = Date.now() - 120_000;
      return {
        ...agent,
        online:
          !!agent.lastSeenAt &&
          agent.lastSeenAt.getTime() >= threshold &&
          agent.status === "ONLINE",
      };
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
      const agent = await prisma.agent.findUnique({
        where: { id: req.params.id },
      });
      if (!agent) return reply.code(404).send({ error: "not_found" });
      const snap = await prisma.crowdSecSnapshot.findUnique({
        where: { agentId: agent.id },
      });
      return snap ?? null;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id/packages",
    { preHandler: requireUser },
    async (req, reply) => {
      const agent = await prisma.agent.findUnique({
        where: { id: req.params.id },
      });
      if (!agent) return reply.code(404).send({ error: "not_found" });
      const packages = await prisma.packageRecord.findMany({
        where: { agentId: agent.id },
        orderBy: { name: "asc" },
      });
      return packages;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id/services",
    { preHandler: requireUser },
    async (req, reply) => {
      const agent = await prisma.agent.findUnique({
        where: { id: req.params.id },
      });
      if (!agent) return reply.code(404).send({ error: "not_found" });
      const services = await prisma.serviceRecord.findMany({
        where: { agentId: agent.id },
        orderBy: { name: "asc" },
      });
      return services;
    },
  );
}
