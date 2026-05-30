import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BinaryDeploySession } from "./binary-deploy-bus.js";
import { resolveRepoRoot } from "./repo-root.js";

const STORE_DIR = path.join(resolveRepoRoot(), "data");
const STORE_FILE = path.join(STORE_DIR, "binary-deploy-sessions.json");
const MAX_PERSISTED = 12;

export function deploySessionsStorePath(): string {
  return STORE_FILE;
}

export function loadPersistedDeploySessions(): BinaryDeploySession[] {
  if (!existsSync(STORE_FILE)) return [];
  try {
    const raw = readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as { sessions?: BinaryDeploySession[] };
    if (!Array.isArray(parsed.sessions)) return [];
    return parsed.sessions
      .filter((s) => s?.id && s.buildId && s.version && Array.isArray(s.events))
      .slice(0, MAX_PERSISTED);
  } catch {
    return [];
  }
}

export function persistDeploySessions(sessions: BinaryDeploySession[]): void {
  try {
    mkdirSync(STORE_DIR, { recursive: true });
    const payload = JSON.stringify(
      { savedAt: new Date().toISOString(), sessions: sessions.slice(0, MAX_PERSISTED) },
      null,
      0,
    );
    const tmp = `${STORE_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, payload, { mode: 0o600 });
    renameSync(tmp, STORE_FILE);
  } catch {
    /* non-fatal — deploy console still works in-memory */
  }
}
