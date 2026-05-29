import compress from "@fastify/compress";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { cspReportOnlyEnabled, fleetHstsEnabled, isProduction } from "../lib/env.js";

export async function registerSecurityPlugins(app: FastifyInstance) {
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
    max: isProduction() ? 240 : 600,
    timeWindow: "1 minute",
    ban: 0,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, context) => ({
      error: "rate_limit_exceeded",
      message: `Too many requests — retry after ${Math.ceil(context.ttl / 1000)}s`,
    }),
  });
}

/** Limit agent enrollment attempts per IP (brute-force / flood). */
export async function registerEnrollRateLimit(app: FastifyInstance) {
  const max = Number(process.env.ENROLL_RATE_MAX ?? (isProduction() ? 20 : 60));
  await app.register(rateLimit, {
    max,
    timeWindow: "15 minutes",
    keyGenerator: (req) => `enroll:${req.ip}`,
    errorResponseBuilder: (_req, context) => ({
      error: "rate_limit_exceeded",
      message: `Too many enrollment attempts — retry after ${Math.ceil(context.ttl / 1000)}s`,
    }),
  });
}

export async function registerAuthRateLimit(app: FastifyInstance) {
  const max = Number(
    process.env.AUTH_LOGIN_RATE_MAX ??
      (isProduction() ? 30 : 120),
  );
  await app.register(rateLimit, {
    max,
    timeWindow: "15 minutes",
    keyGenerator: (req) => `login:${req.ip}`,
    errorResponseBuilder: (_req, context) => ({
      error: "rate_limit_exceeded",
      message: `Too many login attempts — retry after ${Math.ceil(context.ttl / 1000)}s`,
    }),
  });
}
