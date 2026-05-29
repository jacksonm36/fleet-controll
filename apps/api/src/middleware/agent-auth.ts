import type { Agent } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  hashToken,
  isLegacySha256Hash,
  prisma,
  sha256Hex,
} from "@fleet/db";

export type AgentRequestContext = {
  agentId: string;
  agent: Agent;
};

export async function resolveAgentCredential(token: string) {
  const argonHash = await hashToken(token);
  let cred = await prisma.agentCredential.findFirst({
    where: { secretHash: argonHash },
    include: { agent: true },
  });
  if (cred) return cred;

  const legacyHash = sha256Hex(token);
  if (legacyHash !== argonHash) {
    cred = await prisma.agentCredential.findFirst({
      where: { secretHash: legacyHash },
      include: { agent: true },
    });
    if (cred && isLegacySha256Hash(cred.secretHash)) {
      const upgraded = await hashToken(token);
      await prisma.agentCredential.update({
        where: { id: cred.id },
        data: { secretHash: upgraded },
      });
      cred = { ...cred, secretHash: upgraded };
    }
  }
  return cred;
}

export async function requireAgent(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "missing_token" });
  }
  const token = auth.slice("Bearer ".length).trim();
  if (!token) {
    return reply.code(401).send({ error: "missing_token" });
  }
  const cred = await resolveAgentCredential(token);
  if (!cred) {
    return reply.code(401).send({ error: "invalid_token" });
  }
  req.agentCtx = { agentId: cred.agentId, agent: cred.agent };
}
