import type { FastifyReply, FastifyRequest } from "fastify";

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    void reply.code(401).send({ error: "unauthorized" });
  }
}

export function assertOperator(req: FastifyRequest, reply: FastifyReply): boolean {
  const role = (req.user as { role?: string } | undefined)?.role;
  if (role === "VIEWER") {
    void reply.code(403).send({ error: "forbidden" });
    return false;
  }
  return true;
}
