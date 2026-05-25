import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyRequest } from "fastify";

const apiDir = path.dirname(fileURLToPath(import.meta.url));
const installScriptPath = path.resolve(apiDir, "../../../../scripts/install-fleet-agent.sh");

function centralUrlFromRequest(req: FastifyRequest, apiPort: number): string {
  const xfProto = req.headers["x-forwarded-proto"];
  const xfHost = req.headers["x-forwarded-host"];
  const proto =
    (typeof xfProto === "string" && xfProto.split(",")[0]?.trim()) ||
    (req.protocol as string) ||
    "http";
  const hostHeader =
    (typeof xfHost === "string" && xfHost.split(",")[0]?.trim()) ||
    (req.headers.host as string | undefined) ||
    `127.0.0.1:${apiPort}`;
  const hostOnly = hostHeader.includes(":") ? hostHeader.split(":")[0] : hostHeader;
  return `${proto}://${hostOnly}:${apiPort}`;
}

export async function agentInstallPublicRoutes(app: FastifyInstance) {
  app.get("/agent-install.sh", async (req, reply) => {
    const apiPort = Number(process.env.API_PORT ?? 4000);
    const centralDefault = centralUrlFromRequest(req, apiPort);

    let body: string;
    try {
      body = readFileSync(installScriptPath, "utf8");
    } catch {
      return reply.code(500).send({ error: "install_script_missing" });
    }

    const rendered = body.replace(
      /^FLEET_CENTRAL_DEFAULT=.*/m,
      `FLEET_CENTRAL_DEFAULT="${centralDefault}"`,
    );

    return reply
      .header("Content-Type", "text/x-shellscript; charset=utf-8")
      .header("Content-Disposition", 'inline; filename="install-fleet-agent.sh"')
      .send(rendered);
  });
}
