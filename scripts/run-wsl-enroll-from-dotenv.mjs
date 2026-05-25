#!/usr/bin/env node
/**
 * Loads SEED_ADMIN_* from repo .env (simple KEY= parsing) and runs
 * bash /mnt/d/manager/scripts/wsl-mint-and-enroll.sh in WSL Ubuntu.
 *
 * Alternative on Windows clones (CRLF on `/mnt/d/` Bash): prefer
 *
 *    python scripts/enroll-agent-win-to-wsl.py [WSL-distro-name]
 *
 * Usage: node scripts/run-wsl-enroll-from-dotenv.mjs [WSL-distro-name]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function stripQuotes(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseDotEnv(contents) {
  const out = {};
  for (const line of contents.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i === -1) continue;
    const k = l.slice(0, i).trim();
    let v = stripQuotes(l.slice(i + 1));
    out[k] = v;
  }
  return out;
}

function main() {
  const envPath = path.join(root, ".env");
  let raw;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    console.error("Missing .env at repo root:", envPath);
    process.exit(1);
    return;
  }
  const e = parseDotEnv(raw);
  const mail = e.SEED_ADMIN_EMAIL?.trim() || "admin@localhost";
  const pwd = e.SEED_ADMIN_PASSWORD?.trim();
  if (!pwd?.length) {
    console.error("SEED_ADMIN_PASSWORD not set in .env");
    process.exit(1);
    return;
  }

  const distro = process.argv[2]?.trim() || "Ubuntu-22.04";
  const wsl = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wsl.exe");

  const result = spawnSync(
    wsl,
    ["-d", distro, "--", "bash", "/mnt/d/manager/scripts/wsl-mint-and-enroll.sh"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        FLEET_CENTRAL_URL: "http://127.0.0.1:4000",
        FLEET_OPERATOR_EMAIL: mail,
        FLEET_OPERATOR_PASSWORD: pwd,
      },
    },
  );

  process.exit(typeof result.status === "number" ? result.status : 1);
}

main();
