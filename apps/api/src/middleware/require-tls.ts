import type { preHandlerHookHandler } from "fastify/types/hooks.js";

export const requireAgentTls: preHandlerHookHandler = async (req, reply) => {
  if (
    req.protocol === "https" ||
    req.headers["x-forwarded-proto"] === "https"
  ) {
    return;
  }
  return reply.code(403).send({ error: "https_required" });
};
