import compress from "@fastify/compress";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { AppInstance } from "../types/app-instance.js";
import { clientIpFromRequest } from "../lib/client-ip.js";
import { cspReportOnlyEnabled, fleetHstsEnabled, isProduction } from "../lib/env.js";

/** Exported for unit testing; also used directly by registerSecurityPlugins. */
export function globalRateLimitMax(): number {
  const n = Number(process.env.RATE_LIMIT_MAX_PER_MINUTE ?? 0);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return isProduction() ? 120 : 1200;
}

/** Exported for unit testing; also used directly by registerEnrollRateLimit. */
export function enrollRateLimit(): { max: number; timeWindow: string } {
  const max = Number(process.env.ENROLL_RATE_MAX ?? (isProduction() ? 10 : 60));
  const timeWindow = isProduction() ? "1 hour" : "15 minutes";
  return { max, timeWindow };
}

/** Exported for unit testing; also used directly by registerAuthRateLimit. */
export function authRateLimitMax(): number {
  return Number(process.env.AUTH_LOGIN_RATE_MAX ?? (isProduction() ? 5 : 120));
}

function isAgentApiPath(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return path.startsWith("/api/agent/v1");
}

export async function registerSecurityPlugins(app: AppInstance) {
  const cspReportOnly = cspReportOnlyEnabled();
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: cspReportOnly
      ? {
          useDefaults: true,
          directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            "style-src": ["'self'", "'unsafe-inline'"],
            "img-src": ["'self'", "data:", "https:"],
            "connect-src": ["'self'", "https:", "wss:"],
            "font-src": ["'self'", "data:"],
            "frame-ancestors": ["'none'"],
          },
          reportOnly: true,
        }
      : false,
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: fleetHstsEnabled()
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
      : false,
  });

  await app.register(compress, {
    global: true,
    encodings: ["gzip", "deflate"],
    threshold: 1024,
  });

  await app.register(rateLimit, {
    global: true,
    max: globalRateLimitMax(),
    timeWindow: "1 minute",
    ban: 0,
    keyGenerator: (req) => clientIpFromRequest(req) ?? req.ip,
    allowList: (req) => isAgentApiPath(req.url),
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: "rate_limit_exceeded",
      message: `Too many requests — retry after ${Math.ceil(context.ttl / 1000)}s`,
    }),
  });
}

/** Limit agent enrollment attempts per IP (brute-force / flood). */
export async function registerEnrollRateLimit(app: AppInstance) {
  const { max, timeWindow } = enrollRateLimit();
  await app.register(rateLimit, {
    max,
    timeWindow,
    keyGenerator: (req) => `enroll:${req.ip}`,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: "rate_limit_exceeded",
      message: `Too many enrollment attempts — retry after ${Math.ceil(context.ttl / 1000)}s`,
    }),
  });
}

export async function registerAuthRateLimit(app: AppInstance) {
  const max = authRateLimitMax();
  await app.register(rateLimit, {
    max,
    timeWindow: "15 minutes",
    keyGenerator: (req) => `login:${req.ip}`,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: "rate_limit_exceeded",
      message: `Too many login attempts — retry after ${Math.ceil(context.ttl / 1000)}s`,
    }),
  });
}
