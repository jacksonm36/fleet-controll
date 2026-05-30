import type { preHandlerHookHandler } from "fastify/types/hooks.js";
import { fleetAgentMtlsMode } from "../lib/env.js";

/** Parse CN=… from nginx $ssl_client_s_dn (e.g. /CN=clxyz/O=Fleet Agent). */
export function clientCertAgentIdFromDn(dn: string | undefined): string | null {
  if (!dn) return null;
  const m = dn.match(/(?:^|\/)CN=([^/]+)/i);
  return m?.[1]?.trim() ?? null;
}

/** Optional mTLS: when nginx verifies a client cert, CN must match the bearer agent id. */
export async function checkOptionalAgentMtls(
  req: Parameters<preHandlerHookHandler>[0],
  reply: Parameters<preHandlerHookHandler>[1],
): Promise<void> {
  const mode = fleetAgentMtlsMode();
  if (mode === "off") return;

  const verify = String(req.headers["x-ssl-client-verify"] ?? "")
    .trim()
    .toUpperCase();
  const dn = String(req.headers["x-ssl-client-dn"] ?? "");

  if (mode === "required" && verify !== "SUCCESS") {
    reply.code(401).send({
      error: "client_cert_required",
      hint: "Re-enroll or deploy agent client cert; enable nginx optional mTLS include.",
    });
    return;
  }

  if (verify !== "SUCCESS") return;

  const ctx = req.agentCtx;
  if (!ctx) return;

  const certAgentId = clientCertAgentIdFromDn(dn);
  if (!certAgentId) {
    reply.code(403).send({ error: "client_cert_cn_missing" });
    return;
  }
  if (certAgentId !== ctx.agentId) {
    reply.code(403).send({ error: "client_cert_mismatch" });
  }
}

export const verifyOptionalAgentMtls: preHandlerHookHandler = async (req, reply) => {
  await checkOptionalAgentMtls(req, reply);
};
