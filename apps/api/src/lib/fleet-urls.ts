import { existsSync } from "node:fs";
import type { FastifyRequest } from "fastify";
import { fleetAutoEncrypt, fleetPublicHost, fleetRequireTls } from "./env.js";

function hostFromRequest(req: FastifyRequest): string {
  const override = fleetPublicHost();
  if (override) return override;

  const xfHost = req.headers["x-forwarded-host"];
  const hostHeader =
    (typeof xfHost === "string" && xfHost.split(",")[0]?.trim()) ||
    (req.headers.host as string | undefined) ||
    "127.0.0.1";
  return hostHeader.replace(/:\d+$/, "");
}

function requestIsHttps(req: FastifyRequest): boolean {
  if (req.protocol === "https") return true;
  const xf = req.headers["x-forwarded-proto"];
  const raw = Array.isArray(xf) ? xf[0] : xf;
  return raw?.split(",")[0]?.trim().toLowerCase() === "https";
}

/** Canonical public HTTPS URL for agents/UI (env, then TLS flags, then request). */
export function fleetHttpsPublicUrl(
  req: FastifyRequest,
  apiPort: number,
): string | null {
  const envUrl = process.env.FLEET_PUBLIC_URL?.trim().replace(/\/$/, "");
  if (envUrl) return envUrl;

  const host = fleetPublicHost() || hostFromRequest(req);
  if (fleetAutoEncrypt() || fleetRequireTls() || requestIsHttps(req)) {
    return `https://${host}`;
  }

  const xfProto = req.headers["x-forwarded-proto"];
  const proto =
    (typeof xfProto === "string" && xfProto.split(",")[0]?.trim()) ||
    (req.protocol as string) ||
    "http";
  if (proto === "https") {
    return `https://${host}`;
  }
  return null;
}

/** Public URL for install scripts and UI (HTTPS via nginx on 443 when auto-encrypt). */
export function securePublicBase(
  req: FastifyRequest,
  apiPort: number,
): string {
  const httpsUrl = fleetHttpsPublicUrl(req, apiPort);
  if (httpsUrl) return httpsUrl;

  const hostHeader =
    (req.headers["x-forwarded-host"] as string | undefined) ||
    (req.headers.host as string | undefined);
  if (hostHeader) {
    const proto =
      (typeof req.headers["x-forwarded-proto"] === "string" &&
        req.headers["x-forwarded-proto"].split(",")[0]?.trim()) ||
      (req.protocol as string) ||
      "http";
    return `${proto}://${hostHeader.split(",")[0]?.trim()}`;
  }
  return `http://127.0.0.1:${apiPort}`;
}

/** Agent API base URL (HTTPS, same host as UI when TLS terminates on 443). */
export function secureCentralApiUrl(
  req: FastifyRequest,
  apiPort: number,
): string {
  const base = securePublicBase(req, apiPort);
  if (base.startsWith("https://")) {
    try {
      const u = new URL(base);
      if (!u.port || u.port === "443") {
        return `https://${u.hostname}`;
      }
    } catch {
      /* fall through */
    }
  }
  if (base.includes(":3000")) {
    return base.replace(/:3000$/, `:${apiPort}`);
  }
  if (!base.match(/:\d+$/)) {
    return `${base}:${apiPort}`;
  }
  return base;
}

export function fleetCaCertPath(): string | null {
  const candidates = [
    process.env.FLEET_CA_CERT_PATH?.trim(),
    "/etc/fleet/ca.crt",
    "/etc/fleet/ssl/fullchain.pem",
    "/etc/fleet/caddy-ca.crt",
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function fleetTlsProxy(): string {
  return process.env.FLEET_TLS_PROXY?.trim() || "nginx";
}

export function fleetCaDownloadUrl(
  req: FastifyRequest,
  apiPort: number,
): string | null {
  if (!fleetCaCertPath()) return null;
  return `${securePublicBase(req, apiPort)}/api/public/tls-ca.crt`;
}
