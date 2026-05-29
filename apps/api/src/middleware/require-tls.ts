import type { FastifyReply, FastifyRequest } from "fastify";
import { fleetRequireTls } from "../lib/env.js";

export function isRequestSecure(req: FastifyRequest): boolean {
  if (req.protocol === "https") return true;
  const xf = req.headers["x-forwarded-proto"];
  const raw = Array.isArray(xf) ? xf[0] : xf;
  const proto = raw?.split(",")[0]?.trim().toLowerCase();
  return proto === "https";
}

/** Reject agent API traffic when controller is configured to require TLS. */
export async function requireAgentTls(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!fleetRequireTls()) return;
  if (isRequestSecure(req)) return;
  await reply.code(403).send({
    error: "tls_required",
    message:
      "Encrypted transport required for enrollment and agent traffic. Use the install script from https://your-controller (runs setup-fleet-tls.sh) or see docs/SECURITY-TLS.md.",
  });
}
