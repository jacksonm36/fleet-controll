import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { resolveRepoRoot } from "./repo-root.js";

export type AgentReleaseAsset = {
  file: string;
  sha256: string;
  size: number;
};

export type AgentReleaseManifest = {
  version: string;
  buildId: string;
  builtAt: string;
  assets: Record<string, AgentReleaseAsset>;
};

const repoRoot = resolveRepoRoot();
const agentBinDir = path.resolve(repoRoot, "agent/bin");
const manifestPath = path.resolve(agentBinDir, "manifest.json");

const ARCH_ALIASES: Record<string, string> = {
  amd64: "linux-amd64",
  x86_64: "linux-amd64",
  arm64: "linux-arm64",
  aarch64: "linux-arm64",
  "linux-amd64": "linux-amd64",
  "linux-arm64": "linux-arm64",
};

function sha256File(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

function buildIdFromSha256(hex: string): string {
  return hex.slice(0, 12);
}

/** Build manifest from on-disk binaries (used by rebuild script and fallback). */
export function writeAgentManifest(version: string): AgentReleaseManifest {
  const assets: Record<string, AgentReleaseAsset> = {};
  const pairs: [string, string][] = [
    ["linux-amd64", "fleet-agent-linux-amd64"],
    ["linux-arm64", "fleet-agent-linux-arm64"],
  ];
  let primarySha = "";

  for (const [archKey, fileName] of pairs) {
    const filePath = path.resolve(agentBinDir, fileName);
    if (!existsSync(filePath)) continue;
    const sha256 = sha256File(filePath);
    if (!primarySha) primarySha = sha256;
    assets[archKey] = {
      file: fileName,
      sha256,
      size: statSync(filePath).size,
    };
  }

  const manifest: AgentReleaseManifest = {
    version,
    buildId: primarySha ? buildIdFromSha256(primarySha) : "dev",
    builtAt: new Date().toISOString(),
    assets,
  };

  return manifest;
}

export function readAgentManifest(): AgentReleaseManifest | null {
  if (existsSync(manifestPath)) {
    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as AgentReleaseManifest;
      if (raw?.version && raw?.buildId && raw?.assets) return raw;
    } catch {
      /* fall through */
    }
  }

  const amd64 = path.resolve(agentBinDir, "fleet-agent-linux-amd64");
  if (!existsSync(amd64)) return null;
  return writeAgentManifest(process.env.FLEET_AGENT_VERSION ?? "0.4.0");
}

export function normalizeAgentArch(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return ARCH_ALIASES[key] ?? (key.startsWith("linux-") ? key : null);
}

export function releaseForArch(
  manifest: AgentReleaseManifest,
  archKey: string,
): (AgentReleaseAsset & { arch: string; buildId: string; version: string }) | null {
  const asset = manifest.assets[archKey];
  if (!asset) return null;
  return {
    ...asset,
    arch: archKey,
    buildId: manifest.buildId,
    version: manifest.version,
  };
}

export function agentNeedsBinaryUpdate(
  manifest: AgentReleaseManifest,
  archKey: string,
  agentBuild: string | null | undefined,
  agentVersion: string | null | undefined,
): boolean {
  const rel = releaseForArch(manifest, archKey);
  if (!rel) return false;
  const build = (agentBuild ?? "").trim().toLowerCase();
  if (build && build === rel.buildId.toLowerCase()) return false;
  const ver = (agentVersion ?? "").trim().toLowerCase();
  const target = `${rel.version}+${rel.buildId}`.toLowerCase();
  if (ver && ver === target) return false;
  return true;
}

export function publicBinaryPath(fileName: string): string | null {
  const p = path.resolve(agentBinDir, fileName);
  return existsSync(p) ? p : null;
}
