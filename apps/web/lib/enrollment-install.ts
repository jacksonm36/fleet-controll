/** URLs and one-liners for agent bootstrap (HTTP install script → HTTPS enroll). */

export function controllerHostname(): string {
  if (typeof window === "undefined") return "YOUR_CONTROLLER";
  return window.location.hostname || "127.0.0.1";
}

/** HTTPS URL for agents and UI (nginx :443). */
export function httpsPublicUrl(): string {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "https://127.0.0.1";
  }
  const o = window.location.origin;
  if (o.startsWith("http://")) {
    return o.replace(/^http:/, "https:").replace(/:3000$/, "");
  }
  return o.replace(/:3000$/, "").replace(/:4000$/, "");
}

/** Plain HTTP API — use for curl | bash when TLS is not required (lab). */
export function httpInstallBootstrapUrl(): string {
  return `http://${controllerHostname()}:4000/api/public/agent-install-k.sh`;
}

export function httpsInstallBootstrapUrl(): string {
  return `${httpsPublicUrl()}/api/public/agent-install-k.sh`;
}

export function httpFixAgentConnectionUrl(): string {
  return `http://${controllerHostname()}:4000/api/public/fix-agent-connection.sh`;
}

export function httpsFixAgentConnectionUrl(): string {
  return `${httpsPublicUrl()}/api/public/fix-agent-connection.sh`;
}

export function httpInstallBootstrapAltUrl(): string {
  return `http://${controllerHostname()}:3000/api/public/agent-install.sh`;
}

export function shellEscapeToken(token: string): string {
  return token.replace(/'/g, "'\\''");
}

/** Primary install: HTTP bootstrap, HTTPS enroll, auto CA. */
export function buildAgentInstallCommand(token: string): string {
  const t = shellEscapeToken(token);
  return `curl -fsSL '${httpInstallBootstrapUrl()}' | FLEET_ENROLL_TOKEN='${t}' bash`;
}

export function buildAgentReinstallCommand(): string {
  return `curl -fsSL '${httpInstallBootstrapUrl()}' | FLEET_SKIP_ENROLL=1 bash`;
}

export function buildAgentBinaryUpgradeCommand(): string {
  return `curl -fsSL '${httpInstallBootstrapUrl().replace("agent-install-k.sh", "upgrade-fleet-agent-binary.sh")}' | bash`;
}

export function buildAgentBinaryUpgradeHttpsCommand(): string {
  return `curl -kfsSL '${httpsPublicUrl()}/api/public/upgrade-fleet-agent-binary.sh' | bash`;
}

export function buildFixAgentConnectionCommand(): string {
  return `curl -fsSL '${httpFixAgentConnectionUrl()}' | bash`;
}

/** Alternative when port 4000 is blocked; same bootstrap via web proxy. */
export function buildAgentInstallViaWebProxy(token: string): string {
  const t = shellEscapeToken(token);
  return `curl -fsSL '${httpInstallBootstrapAltUrl()}' | FLEET_ENROLL_TOKEN='${t}' bash`;
}

/** HTTPS fetch only if you cannot use HTTP :4000 — requires -k for self-signed nginx. */
export function buildAgentInstallHttpsCommand(token: string): string {
  const t = shellEscapeToken(token);
  const base = httpsPublicUrl();
  return `curl -kfsSL '${base}/api/public/agent-install.sh' | FLEET_ENROLL_TOKEN='${t}' bash`;
}

export const INSTALL_SUCCESS_HINT = [
  "=== Fleet agent install (2-https-bootstrap) ===",
  "Controller: https://…",
  "--- auto-connect: TLS + systemd + verify",
  "Agent online (heartbeat OK).",
  "Done — agent enrolled and online.",
] as const;
