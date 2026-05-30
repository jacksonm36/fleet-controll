import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import type { AppInstance } from "../types/app-instance.js";
import { resolveCorsOrigins, resolveJwtSecret } from "../lib/env.js";
import { requireAgentTls } from "../middleware/require-tls.js";
import { SESSION_COOKIE } from "../lib/session.js";
import {
  registerAuthRateLimit,
  registerEnrollRateLimit,
  registerSecurityPlugins,
} from "../plugins/security.js";
import { agentEnrollRoutes } from "./agent-enroll.js";
import { agentV1Routes } from "./agent-v1.js";
import { agentWsRoutes } from "./agent-ws.js";
import { agentsRoutes } from "./agents.js";
import { authRoutes } from "./auth.js";
import { usersRoutes } from "./users.js";
import { crowdsecRoutes } from "./crowdsec-human.js";
import { agentInstallPublicRoutes } from "./agent-install-public.js";
import { enrollmentRoutes } from "./enrollment.js";
import { fleetRoutes } from "./fleet.js";
import { jobsRoutes } from "./jobs.js";
import { observabilityRoutes } from "./observability.js";
import { patchPlansRoutes } from "./patch-plans.js";
import { scriptsRoutes } from "./scripts.js";

export async function registerRoutes(app: AppInstance) {
  app.get("/health", async () => {
    const { redisPing } = await import("../lib/redis.js");
    const redis = await redisPing();
    return { ok: true, redis };
  });

  await app.register(agentInstallPublicRoutes, { prefix: "/api/public" });
  await app.register(
    async (authScope) => {
      await registerAuthRateLimit(authScope);
      await authScope.register(authRoutes);
    },
    { prefix: "/api/auth" },
  );
  await app.register(enrollmentRoutes, { prefix: "/api/enrollment-tokens" });
  await app.register(usersRoutes, { prefix: "/api/users" });
  await app.register(agentsRoutes, { prefix: "/api/agents" });
  await app.register(jobsRoutes, { prefix: "/api/jobs" });
  await app.register(patchPlansRoutes, { prefix: "/api/patch-plans" });
  await app.register(scriptsRoutes, { prefix: "/api/scripts" });
  await app.register(fleetRoutes, { prefix: "/api/fleet" });
  await app.register(observabilityRoutes, { prefix: "/api/observability" });
  await app.register(crowdsecRoutes, { prefix: "/api/crowdsec" });
  await app.register(
    async (agentScope) => {
      agentScope.addHook("onRequest", requireAgentTls);
      await agentScope.register(
        async (enrollScope) => {
          await registerEnrollRateLimit(enrollScope);
          await enrollScope.register(agentEnrollRoutes);
        },
        { prefix: "/enroll" },
      );
      await agentScope.register(agentV1Routes);
      await agentScope.register(agentWsRoutes);
    },
    { prefix: "/api/agent/v1" },
  );
}

export async function registerPlugins(app: AppInstance) {
  await registerSecurityPlugins(app);

  // Allow DELETE/GET with Content-Type: application/json and no body (browser clients).
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      if (!body || (typeof body === "string" && body.length === 0)) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body as string) as unknown);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  await app.register(cors, {
    origin: resolveCorsOrigins(),
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  await app.register(cookie);

  await app.register(jwt, {
    secret: resolveJwtSecret(),
    cookie: {
      cookieName: SESSION_COOKIE,
      signed: false,
    },
  });

  await app.register(websocket);
}
