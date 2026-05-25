import type { Agent } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@fleet/db";
import { sha256Hex } from "../lib/crypto.js";

export type AgentRequestContext = {
  agentId: string;
  agent: Agent;
};

export async function requireAgent(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "missing_token" });
  }
  const token = auth.slice("Bearer ".length).trim();
  if (!token) {
    return reply.code(401).send({ error: "missing_token" });
  }
  const secretHash = sha256Hex(token);
  const cred = await prisma.agentCredential.findFirst({
    where: { secretHash },
    include: { agent: true },
  });
  if (!cred) {
    return reply.code(401).send({ error: "invalid_token" });
  }
  req.agentCtx = { agentId: cred.agentId, agent: cred.agent };
}
