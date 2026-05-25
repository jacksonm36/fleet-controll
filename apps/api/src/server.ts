import path from "node:path";

import dotenv from "dotenv";
import Fastify from "fastify";

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
  resolveJwtSecret();

  const app = Fastify({
    logger: true,
    trustProxy: resolveTrustProxy(),
    bodyLimit: 1_048_576,
    requestTimeout: 60_000,
  });

  app.setErrorHandler((err, _req, reply) => {
    const status =
      typeof (err as { statusCode?: number }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : 500;
    if (status >= 500) app.log.error(err);
    const message = isProduction() && status >= 500 ? "internal_error" : err.message;
    void reply.code(status).send({
      error: status >= 500 ? "internal_error" : "request_error",
      message,
    });
  });

  await registerPlugins(app);
  await registerRoutes(app);

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
