import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_MARKERS = [
  "scripts/upgrade-fleet-agent-binary.sh",
  "agent/cmd/agent",
] as const;

function hasRepoMarkers(dir: string): boolean {
  return REPO_MARKERS.every((rel) => existsSync(path.join(dir, rel)));
}

/** Fleet monorepo root (works for src/, dist/routes/, and esbuild bundle in dist/server.js). */
export function resolveRepoRoot(fromModuleUrl: string = import.meta.url): string {
  const fromEnv = process.env.FLEET_REPO_ROOT?.trim();
  if (fromEnv && hasRepoMarkers(fromEnv)) {
    return path.resolve(fromEnv);
  }

  let dir = path.dirname(fileURLToPath(fromModuleUrl));
  for (let depth = 0; depth < 10; depth++) {
    if (hasRepoMarkers(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    "Could not resolve Fleet repo root (set FLEET_REPO_ROOT to the monorepo directory)",
  );
}
