import type { preHandlerHookHandler } from "fastify/types/hooks.js";

export type AuthUser = { sub: string; role: string; purpose?: string };

type RequestWithUser = {
  user?: { sub: string; role: string; purpose?: string };
  jwtVerify(): Promise<unknown>;
};
type ReplyWithCode = {
  code(statusCode: number): { send(payload: unknown): unknown };
};

export function getAuthUser(req: RequestWithUser): AuthUser | undefined {
  return req.user as AuthUser | undefined;
}

export function actorId(req: RequestWithUser): string {
  return getAuthUser(req)?.sub ?? "";
}

export function actorRole(req: RequestWithUser): string | undefined {
  return getAuthUser(req)?.role;
}

export const requireUser: preHandlerHookHandler = async (req, reply) => {
  try {
    await req.jwtVerify();
    const purpose = getAuthUser(req)?.purpose;
    if (purpose && purpose !== "session") {
      void reply.code(401).send({ error: "unauthorized" });
    }
  } catch {
    void reply.code(401).send({ error: "unauthorized" });
  }
};

export const requireMfaPending: preHandlerHookHandler = async (req, reply) => {
  try {
    await req.jwtVerify();
    if (getAuthUser(req)?.purpose !== "mfa_pending") {
      void reply.code(401).send({ error: "unauthorized" });
    }
  } catch {
    void reply.code(401).send({ error: "unauthorized" });
  }
};

export function assertOperator(req: RequestWithUser, reply: ReplyWithCode): boolean {
  const role = actorRole(req);
  if (role === "VIEWER") {
    void reply.code(403).send({ error: "forbidden" });
    return false;
  }
  return true;
}

export function assertAdmin(req: RequestWithUser, reply: ReplyWithCode): boolean {
  if (actorRole(req) !== "ADMIN") {
    void reply.code(403).send({ error: "forbidden" });
    return false;
  }
  return true;
}
