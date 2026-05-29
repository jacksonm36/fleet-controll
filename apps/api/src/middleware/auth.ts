import type { FastifyReply, FastifyRequest } from "fastify";

export type AuthUser = { sub: string; role: string; purpose?: string };

export function getAuthUser(req: FastifyRequest): AuthUser | undefined {
  return req.user as AuthUser | undefined;
}

export function actorId(req: FastifyRequest): string {
  return getAuthUser(req)?.sub ?? "";
}

export function actorRole(req: FastifyRequest): string | undefined {
  return getAuthUser(req)?.role;
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    const purpose = getAuthUser(req)?.purpose;
    if (purpose && purpose !== "session") {
      void reply.code(401).send({ error: "unauthorized" });
    }
  } catch {
    void reply.code(401).send({ error: "unauthorized" });
  }
}

export async function requireMfaPending(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    if (getAuthUser(req)?.purpose !== "mfa_pending") {
      void reply.code(401).send({ error: "unauthorized" });
    }
  } catch {
    void reply.code(401).send({ error: "unauthorized" });
  }
}

export function assertOperator(req: FastifyRequest, reply: FastifyReply): boolean {
  const role = actorRole(req);
  if (role === "VIEWER") {
    void reply.code(403).send({ error: "forbidden" });
    return false;
  }
  return true;
}

export function assertAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (actorRole(req) !== "ADMIN") {
    void reply.code(403).send({ error: "forbidden" });
    return false;
  }
  return true;
}
