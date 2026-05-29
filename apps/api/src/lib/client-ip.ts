import type { FastifyRequest } from "fastify";

function normalizeIp(raw: string | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  if (!ip) return null;
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice("::ffff:".length);
  }
  if (ip.includes(":") && !ip.includes(".")) {
    return null;
  }
  if (ip.length > 45) return null;
  return ip;
}

/** Best-effort client IP for agent HTTP requests (heartbeat, metrics, inventory). */
export function clientIpFromRequest(req: FastifyRequest): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const first = forwarded.split(",")[0]?.trim();
    const ip = normalizeIp(first);
    if (ip) return ip;
  }
  return normalizeIp(req.ip);
}

export function hostIpUpdateFromPayload(
  host:
    | {
        primaryIp?: string | null;
        addresses?: string[] | null;
      }
    | undefined
    | null,
  fallbackIp: string | null,
): { primaryIp?: string; ipAddresses?: string[] } {
  const primary = host?.primaryIp?.trim().slice(0, 45) || null;
  const addresses = (host?.addresses ?? [])
    .map((a) => a.trim().slice(0, 45))
    .filter(Boolean)
    .slice(0, 32);
  const unique = [...new Set(addresses)];

  if (primary) {
    return {
      primaryIp: primary,
      ...(unique.length ? { ipAddresses: unique } : {}),
    };
  }
  if (fallbackIp) {
    return { primaryIp: fallbackIp };
  }
  return {};
}

/** Use on heartbeat when the agent has not reported interface addresses yet. */
export function connectedIpFallbackUpdate(
  existingPrimaryIp: string | null | undefined,
  fallbackIp: string | null,
): { primaryIp?: string } {
  if (existingPrimaryIp?.trim() || !fallbackIp) {
    return {};
  }
  return { primaryIp: fallbackIp };
}
