import { createReadStream, existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import type { AppInstance, AppReply, AppRequest } from "../types/app-instance.js";
import {
  fleetCaCertPath,
  fleetCaDownloadUrl,
  fleetHttpsPublicUrl,
  secureCentralApiUrl,
  securePublicBase,
} from "../lib/fleet-urls.js";
import {
  fleetPublicHost,
  fleetRequireTls,
  fleetTlsMinVersionForAgents,
  fleetTlsPinAuto,
} from "../lib/env.js";
import { fleetMtlsCaReady } from "../lib/fleet-mtls.js";
import { controllerTlsPinInfo } from "../lib/fleet-tls-pin.js";
import { readAgentManifest } from "../lib/agent-release.js";
import { resolveRepoRoot } from "../lib/repo-root.js";

const repoRoot = resolveRepoRoot();
const installScriptPath = path.resolve(repoRoot, "scripts/install-fleet-agent.sh");
const prebuiltInstallPath = path.resolve(
  repoRoot,
  "scripts/agent-install-prebuilt.sh",
);
const enrollScriptPath = path.resolve(
  repoRoot,
  "scripts/fleet-agent-curl-enroll.sh",
);
const tlsHelperPath = path.resolve(repoRoot, "scripts/fleet-ensure-tls-ca.sh");
const scannersHelperPath = path.resolve(
  repoRoot,
  "scripts/install-fleet-agent-scanners.sh",
);
const fixAgentConnectionPath = path.resolve(
  repoRoot,
  "scripts/fix-agent-connection.sh",
);
const systemdHelperPath = path.resolve(
  repoRoot,
  "scripts/fleet-agent-systemd.sh",
);
const wslAutostartPath = path.resolve(
  repoRoot,
  "scripts/wsl-fleet-agent-autostart.sh",
);
const discoverCentralPath = path.resolve(
  repoRoot,
  "scripts/fleet-discover-central.sh",
);
const upgradeBinaryPath = path.resolve(
  repoRoot,
  "scripts/upgrade-fleet-agent-binary.sh",
);

const PUBLIC_HELPER_SCRIPTS: Record<string, string> = {
  "wsl-fleet-agent-autostart.sh": wslAutostartPath,
  "fleet-agent-systemd.sh": systemdHelperPath,
  "fleet-discover-central.sh": discoverCentralPath,
};
const goSetupScript = path.resolve(repoRoot, "scripts/go-agent-setup-linux.sh");
const agentDir = path.resolve(repoRoot, "agent");
const agentBinDir = path.resolve(agentDir, "bin");

const BUILTIN_BINARIES: Record<string, string> = {
  "fleet-agent-linux-amd64": path.resolve(agentBinDir, "fleet-agent-linux-amd64"),
  "fleet-agent-linux-arm64": path.resolve(agentBinDir, "fleet-agent-linux-arm64"),
};

function resolveAgentBinary(name: string): string | null {
  const envKey = `FLEET_AGENT_${name.replace(/-/g, "_").toUpperCase()}`;
  const fromEnv = process.env[envKey];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const builtin = BUILTIN_BINARIES[name];
  if (builtin && existsSync(builtin)) return builtin;
  const local = path.resolve(
    process.env.HOME ?? repoRoot,
    ".local/bin/fleet-agent",
  );
  if (name === "fleet-agent-linux-amd64" && existsSync(local)) return local;
  return null;
}

function embedTlsHelper(body: string): string {
  const marker = "# __FLEET_TLS_HELPER_EMBED__";
  if (!body.includes(marker)) return body;
  let helper = "";
  try {
    helper = readFileSync(tlsHelperPath, "utf8");
  } catch {
    return body;
  }
  return body.replace(marker, helper.trimEnd());
}

function embedScannersHelper(body: string): string {
  const marker = "# __FLEET_SCANNERS_EMBED__";
  if (!body.includes(marker)) return body;
  let helper = "";
  try {
    helper = readFileSync(scannersHelperPath, "utf8");
  } catch {
    return body.replace(marker, "");
  }
  return body.replace(marker, helper.trimEnd());
}

function embedSystemdHelper(body: string): string {
  const marker = "# __FLEET_SYSTEMD_EMBED__";
  if (!body.includes(marker)) return body;
  let helper = "";
  try {
    helper = readFileSync(systemdHelperPath, "utf8");
  } catch {
    return body.replace(marker, "");
  }
  return body.replace(marker, helper.trimEnd());
}

function embedInstallHelpers(body: string): string {
  return embedSystemdHelper(embedScannersHelper(embedTlsHelper(body)));
}

function setInjectedVar(body: string, key: string, value: string): string {
  const line = `${key}="${value}"`;
  if (new RegExp(`^${key}=.*`, "m").test(body)) {
    return body.replace(new RegExp(`^${key}=.*`, "m"), line);
  }
  return `${line}\n${body}`;
}

function injectInstallVars(
  body: string,
  req: AppRequest,
  apiPort: number,
): string {
  const publicBase = securePublicBase(req, apiPort);
  const centralDefault = secureCentralApiUrl(req, apiPort);
  const binaryBase = `${publicBase}/api/public`;
  const caUrl = fleetCaDownloadUrl(req, apiPort);
  const httpsPublic = fleetHttpsPublicUrl(req, apiPort);
  const discoverHost = fleetPublicHost() || publicBase.replace(/^https?:\/\//, "").replace(/:\d+$/, "");

  let out = body
    .replace(/^FLEET_CENTRAL_DEFAULT=.*/m, `FLEET_CENTRAL_DEFAULT="${centralDefault}"`)
    .replace(/^FLEET_AGENT_BINARY_URL=.*/m, `FLEET_AGENT_BINARY_URL="${binaryBase}"`)
    .replace(/^FLEET_PUBLIC_BASE=.*/m, `FLEET_PUBLIC_BASE="${binaryBase}"`);

  if (httpsPublic) {
    out = setInjectedVar(out, "FLEET_HTTPS_PUBLIC_URL", httpsPublic);
  }
  if (discoverHost) {
    out = setInjectedVar(out, "FLEET_DISCOVER_HOST", discoverHost);
  }
  if (fleetRequireTls()) {
    out = setInjectedVar(out, "FLEET_REQUIRE_TLS_BOOTSTRAP", "1");
  }

  if (fleetTlsPinAuto()) {
    out = setInjectedVar(out, "FLEET_TLS_PIN_AUTO", "1");
  }
  const minTls = fleetTlsMinVersionForAgents();
  if (minTls) {
    out = setInjectedVar(out, "FLEET_TLS_MIN_VERSION", minTls);
  }

  // Safe install: do not apt-install docker.io or other scanner deps unless opted in.
  out = setInjectedVar(out, "FLEET_SKIP_SCANNER_DEPS", "1");

  out = embedInstallHelpers(out);

  if (caUrl) {
    if (/^FLEET_CA_DOWNLOAD_URL=.*/m.test(out)) {
      out = out.replace(/^FLEET_CA_DOWNLOAD_URL=.*/m, `FLEET_CA_DOWNLOAD_URL="${caUrl}"`);
    } else {
      out = `FLEET_CA_DOWNLOAD_URL="${caUrl}"\n${out}`;
    }
  }
  return out;
}

function renderInstallScript(req: AppRequest, apiPort: number): string {
  let body = readFileSync(installScriptPath, "utf8");
  body = injectInstallVars(body, req, apiPort);
  const sourceUrl = `${securePublicBase(req, apiPort)}/api/public/agent-source.tar.gz`;
  body = body.replace(
    /^FLEET_AGENT_SOURCE_URL=.*/m,
    `FLEET_AGENT_SOURCE_URL="${sourceUrl}"`,
  );
  return setInjectedVar(body, "FLEET_INSTALLER_BUILD", "2-https-bootstrap");
}

function renderBootstrapInstaller(
  req: AppRequest,
  apiPort: number,
  usageUrl: string,
): string {
  const rendered = renderInstallScript(req, apiPort);
  const host = fleetPublicHost() || hostFromRequest(req);
  return `#!/usr/bin/env bash
# Fleet agent install (HTTP bootstrap, build 2). Controller: https://${host}
# New host:  curl -fsSL '${usageUrl}' | FLEET_ENROLL_TOKEN='…' bash
# Update:   curl -fsSL '${usageUrl}' | FLEET_SKIP_ENROLL=1 bash
set -euo pipefail
if [[ "\${FLEET_SKIP_ENROLL:-0}" != "1" && -z "\${FLEET_ENROLL_TOKEN:-}" ]]; then
  echo "Set FLEET_ENROLL_TOKEN (Fleet UI → Enrollment) or FLEET_SKIP_ENROLL=1 if already enrolled." >&2
  exit 1
fi
export FLEET_ENROLL_TOKEN
export FLEET_SKIP_ENROLL
exec bash <<'FLEET_INSTALL_BODY'
${rendered}
FLEET_INSTALL_BODY
`;
}

function hostFromRequest(req: AppRequest): string {
  const xfHost = req.headers["x-forwarded-host"];
  const hostHeader =
    (typeof xfHost === "string" && xfHost.split(",")[0]?.trim()) ||
    (req.headers.host as string | undefined) ||
    "127.0.0.1";
  return hostHeader.replace(/:\d+$/, "");
}

export async function agentInstallPublicRoutes(app: AppInstance) {
  const serveCaPem = async (_req: AppRequest, reply: AppReply) => {
    const caPath = fleetCaCertPath();
    if (!caPath) {
      return reply.code(404).send({
        error: "ca_not_available",
        message:
          "Run sudo bash scripts/setup-fleet-tls-nginx.sh on the controller, or set FLEET_SSL_CERT.",
      });
    }
    const pem = readFileSync(caPath, "utf8");
    return reply
      .header("Content-Type", "application/x-pem-file")
      .header(
        "Content-Disposition",
        'attachment; filename="fleet-controller-ca.crt"',
      )
      .send(pem);
  };

  app.get("/tls-ca.crt", serveCaPem);
  app.get("/caddy-ca.crt", serveCaPem);

  app.get("/tls-pin.json", async (_req, reply) => {
    const pin = controllerTlsPinInfo();
    if (!pin) {
      return reply.code(404).send({
        error: "pin_not_available",
        message: "Controller TLS certificate not found on disk.",
      });
    }
    return pin;
  });

  const sendBootstrapInstaller = (
    req: AppRequest,
    reply: AppReply,
    usageUrl: string,
    filename: string,
  ) => {
    const apiPort = Number(process.env.API_PORT ?? 4000);
    try {
      const script = renderBootstrapInstaller(req, apiPort, usageUrl);
      return reply
        .header("Content-Type", "text/x-shellscript; charset=utf-8")
        .header("Content-Disposition", `inline; filename="${filename}"`)
        .send(script);
    } catch {
      return reply.code(500).send({ error: "install_script_missing" });
    }
  };

  app.get("/agent-install-k.sh", async (req, reply) => {
    const apiPort = Number(process.env.API_PORT ?? 4000);
    const usageUrl = `${securePublicBase(req, apiPort)}/api/public/agent-install-k.sh`;
    return sendBootstrapInstaller(
      req,
      reply,
      usageUrl,
      "agent-install-k.sh",
    );
  });

  app.get("/agent-install.sh", async (req, reply) => {
    const apiPort = Number(process.env.API_PORT ?? 4000);
    const usageUrl = `${securePublicBase(req, apiPort)}/api/public/agent-install.sh`;
    return sendBootstrapInstaller(
      req,
      reply,
      usageUrl,
      "install-fleet-agent.sh",
    );
  });

  app.get("/agent-manifest.json", async (_req, reply) => {
    const manifest = readAgentManifest();
    if (!manifest) {
      return reply.code(404).send({
        error: "binary_not_built",
        hint: "Run scripts/rebuild-fleet-agent.sh on the controller.",
      });
    }
    return reply.header("Cache-Control", "no-store").send(manifest);
  });

  app.get("/upgrade-fleet-agent-binary.sh", async (req, reply) => {
    const apiPort = Number(process.env.API_PORT ?? 4000);
    const host = fleetPublicHost() || hostFromRequest(req);
    try {
      let body = readFileSync(upgradeBinaryPath, "utf8");
      body = embedTlsHelper(body);
      body = setInjectedVar(body, "FLEET_DISCOVER_HOST", host);
      body = setInjectedVar(body, "FLEET_CENTRAL_DEFAULT", secureCentralApiUrl(req, apiPort));
      const httpsPublic = fleetHttpsPublicUrl(req, apiPort);
      if (httpsPublic) {
        body = setInjectedVar(body, "FLEET_HTTPS_PUBLIC_URL", httpsPublic);
        body = setInjectedVar(body, "FLEET_PUBLIC_BASE", `${httpsPublic}/api/public`);
      }
      body = body.replace(
        /^FLEET_CA_DOWNLOAD_URL=.*/m,
        `FLEET_CA_DOWNLOAD_URL="${fleetCaDownloadUrl(req, apiPort) ?? `https://${host}/api/public/tls-ca.crt`}"`,
      );
      return reply
        .header("Content-Type", "text/x-shellscript; charset=utf-8")
        .header(
          "Content-Disposition",
          'inline; filename="upgrade-fleet-agent-binary.sh"',
        )
        .send(body);
    } catch {
      return reply.code(500).send({ error: "upgrade_script_missing" });
    }
  });

  app.get("/fix-agent-connection.sh", async (req, reply) => {
    const apiPort = Number(process.env.API_PORT ?? 4000);
    const host = fleetPublicHost() || hostFromRequest(req);
    try {
      let body = readFileSync(fixAgentConnectionPath, "utf8");
      body = embedInstallHelpers(body);
      body = setInjectedVar(body, "FLEET_DISCOVER_HOST", host);
      const httpsPublic = fleetHttpsPublicUrl(req, apiPort);
      if (httpsPublic) {
        body = setInjectedVar(body, "FLEET_HTTPS_PUBLIC_URL", httpsPublic);
      }
      if (fleetRequireTls()) {
        body = setInjectedVar(body, "FLEET_REQUIRE_TLS_BOOTSTRAP", "1");
      }
      if (fleetTlsPinAuto()) {
        body = setInjectedVar(body, "FLEET_TLS_PIN_AUTO", "1");
      }
      const minTls = fleetTlsMinVersionForAgents();
      if (minTls) {
        body = setInjectedVar(body, "FLEET_TLS_MIN_VERSION", minTls);
      }
      body = body.replace(
        /^FLEET_CA_DOWNLOAD_URL=.*/m,
        `FLEET_CA_DOWNLOAD_URL="${fleetCaDownloadUrl(req, apiPort) ?? `https://${host}/api/public/tls-ca.crt`}"`,
      );
      return reply
        .header("Content-Type", "text/x-shellscript; charset=utf-8")
        .header(
          "Content-Disposition",
          'inline; filename="fix-agent-connection.sh"',
        )
        .send(body);
    } catch {
      return reply.code(500).send({ error: "fix_script_missing" });
    }
  });

  for (const [name, scriptPath] of Object.entries(PUBLIC_HELPER_SCRIPTS)) {
    app.get(`/${name}`, async (req, reply) => {
      if (!existsSync(scriptPath)) {
        return reply.code(404).send({ error: "script_missing", name });
      }
      const apiPort = Number(process.env.API_PORT ?? 4000);
      const host = fleetPublicHost() || hostFromRequest(req);
      try {
        let body = readFileSync(scriptPath, "utf8");
        body = embedInstallHelpers(body);
        body = setInjectedVar(body, "FLEET_DISCOVER_HOST", host);
        const httpsPublic = fleetHttpsPublicUrl(req, apiPort);
        if (httpsPublic) {
          body = setInjectedVar(body, "FLEET_HTTPS_PUBLIC_URL", httpsPublic);
        }
        return reply
          .header("Content-Type", "text/x-shellscript; charset=utf-8")
          .header("Content-Disposition", `inline; filename="${name}"`)
          .send(body);
      } catch {
        return reply.code(500).send({ error: "script_read_failed", name });
      }
    });
  }

  app.get("/agent-enroll.sh", async (req, reply) => {
    const apiPort = Number(process.env.API_PORT ?? 4000);

    let body: string;
    try {
      body = readFileSync(enrollScriptPath, "utf8");
    } catch {
      return reply.code(500).send({ error: "enroll_script_missing" });
    }

    const rendered = injectInstallVars(body, req, apiPort);

    return reply
      .header("Content-Type", "text/x-shellscript; charset=utf-8")
      .header("Content-Disposition", 'inline; filename="agent-enroll.sh"')
      .send(rendered);
  });

  app.get("/agent-install-prebuilt.sh", async (req, reply) => {
    const apiPort = Number(process.env.API_PORT ?? 4000);

    let body: string;
    try {
      body = readFileSync(prebuiltInstallPath, "utf8");
    } catch {
      return reply.code(500).send({ error: "prebuilt_install_script_missing" });
    }

    const rendered = injectInstallVars(body, req, apiPort);

    return reply
      .header("Content-Type", "text/x-shellscript; charset=utf-8")
      .header(
        "Content-Disposition",
        'inline; filename="agent-install-prebuilt.sh"',
      )
      .send(rendered);
  });

  app.get("/agent-source.tar.gz", async (_req, reply) => {
    if (!existsSync(agentDir) || !existsSync(goSetupScript)) {
      return reply.code(500).send({ error: "agent_source_missing" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "application/gzip",
      "Content-Disposition": 'attachment; filename="agent-source.tar.gz"',
    });

    const tar = spawn(
      "tar",
      ["-czf", "-", "-C", repoRoot, "agent", "scripts/go-agent-setup-linux.sh"],
      { stdio: ["ignore", "pipe", "inherit"] },
    );

    tar.stdout.pipe(reply.raw);
    tar.on("close", (code) => {
      if (code !== 0) {
        reply.raw.end();
      } else {
        reply.raw.end();
      }
    });
    tar.on("error", () => {
      if (!reply.raw.writableEnded) reply.raw.end();
    });
  });

  for (const asset of Object.keys(BUILTIN_BINARIES)) {
    app.get(`/${asset}`, async (_req, reply) => {
      const binPath = resolveAgentBinary(asset);
      if (!binPath) {
        return reply.code(404).send({
          error: "binary_not_built",
          hint: `On controller run: bash scripts/rebuild-fleet-agent.sh`,
        });
      }
      const manifest = readAgentManifest();
      const headers: Record<string, string> = {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${asset}"`,
        "Cache-Control": "no-store",
      };
      if (manifest?.buildId) {
        headers["X-Fleet-Build-Id"] = manifest.buildId;
        headers["X-Fleet-Agent-Version"] = manifest.version;
      }
      return reply.headers(headers).send(createReadStream(binPath));
    });
  }
}
