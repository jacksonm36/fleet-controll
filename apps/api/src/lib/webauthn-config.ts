import type { FastifyRequest } from "fastify";
import { fleetPublicHost } from "./env.js";

export function webAuthnRpName(): string {
  return process.env.WEBAUTHN_RP_NAME?.trim() || "Fleet Patch Control";
}

export function webAuthnRpId(req?: FastifyRequest): string {
  const configured = process.env.WEBAUTHN_RP_ID?.trim();
  if (configured) return configured;
  const host = fleetPublicHost()?.split(":")[0]?.trim();
  if (host) return host;
  const headerHost = req?.headers.host?.split(":")[0]?.trim();
  if (headerHost && headerHost !== "127.0.0.1" && headerHost !== "localhost") {
    return headerHost;
  }
  return "localhost";
}

export function webAuthnOrigin(req: FastifyRequest): string {
  const configured = process.env.WEBAUTHN_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ||
    (req.protocol === "https" ? "https" : "http");
  const host = req.headers.host?.trim();
  if (host) return `${proto}://${host}`;
  const publicHost = fleetPublicHost();
  if (publicHost) return `${proto}://${publicHost}`;
  return `${proto}://localhost:3001`;
}
