import { prisma } from "@fleet/db";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../middleware/auth.js";

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
          _count: { select: { packages: true, services: true } },
        },
      });
      if (!agent) return reply.code(404).send({ error: "not_found" });
      return agent;
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
