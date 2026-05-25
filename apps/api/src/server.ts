import path from "node:path";

import dotenv from "dotenv";
import Fastify from "fastify";

import { registerPlugins, registerRoutes } from "./routes/register.js";

for (const envPath of [
  path.resolve(process.cwd(), "../../.env"),
  path.resolve(process.cwd(), "../.env"),
  path.resolve(process.cwd(), ".env"),
]) {
  dotenv.config({ path: envPath });
}

async function main() {
  const app = Fastify({ logger: true });
  await registerPlugins(app);
  await registerRoutes(app);

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
