import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { resolveCorsOrigins, resolveJwtSecret } from "../lib/env.js";
import {
  registerAuthRateLimit,
  registerSecurityPlugins,
} from "../plugins/security.js";
import { agentV1Routes } from "./agent-v1.js";
import { agentWsRoutes } from "./agent-ws.js";
import { agentsRoutes } from "./agents.js";
import { authRoutes } from "./auth.js";
import { crowdsecRoutes } from "./crowdsec-human.js";
import { agentInstallPublicRoutes } from "./agent-install-public.js";
import { enrollmentRoutes } from "./enrollment.js";
import { fleetRoutes } from "./fleet.js";
import { jobsRoutes } from "./jobs.js";

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  await app.register(agentInstallPublicRoutes, { prefix: "/api/public" });
  await app.register(
    async (authScope) => {
      await registerAuthRateLimit(authScope);
      await authScope.register(authRoutes);
    },
    { prefix: "/api/auth" },
  );
  await app.register(enrollmentRoutes, { prefix: "/api/enrollment-tokens" });
  await app.register(agentsRoutes, { prefix: "/api/agents" });
  await app.register(jobsRoutes, { prefix: "/api/jobs" });
  await app.register(fleetRoutes, { prefix: "/api/fleet" });
  await app.register(crowdsecRoutes, { prefix: "/api/crowdsec" });
  await app.register(agentV1Routes, { prefix: "/api/agent/v1" });
  await app.register(agentWsRoutes, { prefix: "/api/agent/v1" });
}

export async function registerPlugins(app: FastifyInstance) {
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

  await app.register(jwt, { secret: resolveJwtSecret() });

  await app.register(websocket);
}
