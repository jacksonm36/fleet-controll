import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
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
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(enrollmentRoutes, { prefix: "/api/enrollment-tokens" });
  await app.register(agentsRoutes, { prefix: "/api/agents" });
  await app.register(jobsRoutes, { prefix: "/api/jobs" });
  await app.register(fleetRoutes, { prefix: "/api/fleet" });
  await app.register(crowdsecRoutes, { prefix: "/api/crowdsec" });
  await app.register(agentV1Routes, { prefix: "/api/agent/v1" });
  await app.register(agentWsRoutes, { prefix: "/api/agent/v1" });
}

export async function registerPlugins(app: FastifyInstance) {
  const corsOrigin = process.env.CORS_ORIGIN;
  await app.register(cors, {
    origin:
      corsOrigin && corsOrigin.length > 0
        ? corsOrigin.split(",").map((s) => s.trim())
        : true,
  });

  const secret =
    process.env.JWT_SECRET ?? "dev-change-me-use-32-plus-characters-secret";
  await app.register(jwt, { secret });

  await app.register(websocket);
}
