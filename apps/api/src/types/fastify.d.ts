import type { Agent } from "@prisma/client";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: string; purpose?: string };
    user: { sub: string; role: string; purpose?: string };
  }
}

declare module "fastify" {
  interface FastifyRequest {
    agentCtx?: {
      agentId: string;
      agent: Agent;
    };
    user?: { sub: string; role: string; purpose?: string };
    jwtVerify(): Promise<unknown>;
  }

  interface FastifyReply {
    jwtSign(
      payload: Record<string, unknown>,
      options?: { expiresIn?: string },
    ): Promise<string>;
    setCookie(
      name: string,
      value: string,
      options?: Record<string, unknown>,
    ): void;
    clearCookie(name: string, options?: Record<string, unknown>): void;
  }

  interface FastifyInstance {
    jwt: {
      sign(
        payload: Record<string, unknown>,
        options?: { expiresIn?: string },
      ): string;
    };
  }

  interface RouteShorthandOptions {
    websocket?: boolean;
  }
}
