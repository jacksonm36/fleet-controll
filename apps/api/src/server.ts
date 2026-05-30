import path from "node:path";

import dotenv from "dotenv";
import { fastify } from "./types/app-instance.js";

import { isProduction } from "./lib/env.js";
import { registerPlugins, registerRoutes } from "./routes/register.js";

for (const envPath of [
  path.resolve(process.cwd(), "../../.env"),
  path.resolve(process.cwd(), "../.env"),
  path.resolve(process.cwd(), ".env"),
]) {
  dotenv.config({ path: envPath });
}

async function main() {
  const { resolveJwtSecret, resolveTrustProxy } = await import("./lib/env.js");
  const { assertProductionSecrets } = await import("./lib/security-config.js");
  resolveJwtSecret();
  assertProductionSecrets();

  const app = fastify({
    logger: true,
    trustProxy: resolveTrustProxy(),
    bodyLimit: 1_048_576,
    requestTimeout: 60_000,
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    let status =
      typeof err.statusCode === "number" ? err.statusCode : 500;

    const msg = err.message ?? "";
    const code = (err as { code?: string }).code ?? "";
    if (
      status === 429 ||
      msg.includes("rate_limit") ||
      msg.includes("Too many requests") ||
      code === "FST_ERR_RATE_LIMIT" ||
      code === "FST_ERR_RATE_LIMIT_EXCEEDED"
    ) {
      status = 429;
    }

    if (status >= 500) app.log.error(err);

    const clientMessage =
      status === 429
        ? msg || "Too many requests — try again shortly"
        : isProduction() && status >= 500
          ? "internal_error"
          : msg;

    void reply.code(status).send({
      error:
        status === 429
          ? "rate_limit_exceeded"
          : status >= 500
            ? "internal_error"
            : "request_error",
      message: clientMessage,
    });
  });

  await registerPlugins(app);
  await registerRoutes(app);

  const { reconcileAllStaleJobs } = await import("./lib/job-reconcile.js");
  const reconcileMs = Number(process.env.JOB_RECONCILE_INTERVAL_MS ?? 60_000);
  setInterval(() => {
    void reconcileAllStaleJobs().catch((err) => {
      app.log.warn({ err }, "job reconcile failed");
    });
  }, reconcileMs).unref();

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
