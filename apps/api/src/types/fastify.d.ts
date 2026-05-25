declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: string };
    user: { sub: string; role: string };
  }
}

declare module "fastify" {
  interface FastifyRequest {
    agentCtx?: {
      agentId: string;
      agent: import("@prisma/client").Agent;
    };
  }
}
