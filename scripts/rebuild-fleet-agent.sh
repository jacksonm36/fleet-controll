#!/usr/bin/env bash
# Rebuild fleet-agent binaries, write manifest.json, and notify online agents.
#
# Usage (on controller):
#   bash scripts/rebuild-fleet-agent.sh
#   FLEET_AGENT_VERSION=0.4.1 bash scripts/rebuild-fleet-agent.sh
#   NOTIFY=0 bash scripts/rebuild-fleet-agent.sh   # skip websocket push
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${FLEET_AGENT_VERSION:-0.4.0}"
NOTIFY="${NOTIFY:-1}"
BIN_DIR="$ROOT/agent/bin"

echo "=== Rebuild Fleet agent binaries (version ${VERSION}) ==="

build_one() {
	local goarch="$1"
	local out_name="$2"
	local build_id="${3:-dev}"
	local out="$BIN_DIR/$out_name"
	local ldflags="-s -w -X main.AgentVersion=${VERSION} -X main.AgentBuild=${build_id}"
	echo "  GOARCH=${goarch} → ${out_name} (build=${build_id})" >&2
	(
		cd agent
		GOOS=linux GOARCH="$goarch" go build -ldflags "$ldflags" -o "bin/${out_name}" ./cmd/agent
	)
}

sha12() {
	sha256sum "$1" | awk '{print $1}' | head -c 12
}

stamp_binary() {
	local goarch="$1"
	local out_name="$2"
	build_one "$goarch" "$out_name" "pending"
	local bid
	bid="$(sha12 "$BIN_DIR/$out_name")"
	build_one "$goarch" "$out_name" "$bid"
	printf '%s' "$bid"
}

mkdir -p "$BIN_DIR"

AMD_BUILD="$(stamp_binary amd64 fleet-agent-linux-amd64)"
echo "  linux-amd64 buildId=${AMD_BUILD}"

if GOOS=linux GOARCH=arm64 go build -o /dev/null ./agent/cmd/agent 2>/dev/null; then
	ARM_BUILD="$(stamp_binary arm64 fleet-agent-linux-arm64)" || true
	if [[ -n "${ARM_BUILD:-}" ]]; then
		echo "  linux-arm64 buildId=${ARM_BUILD}"
	fi
fi

echo "Writing agent/bin/manifest.json…"
export AMD_BUILD
python3 <<PY
import hashlib, json, os
from datetime import datetime, timezone

version = "$VERSION"
bin_dir = "$BIN_DIR"
build_id = os.environ.get("AMD_BUILD", "dev")
assets = {}
for arch, name in [("linux-amd64", "fleet-agent-linux-amd64"), ("linux-arm64", "fleet-agent-linux-arm64")]:
    path = os.path.join(bin_dir, name)
    if not os.path.isfile(path):
        continue
    h = hashlib.sha256(open(path, "rb").read()).hexdigest()
    assets[arch] = {"file": name, "sha256": h, "size": os.stat(path).st_size}
manifest = {
    "version": version,
    "buildId": build_id,
    "builtAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "assets": assets,
}
out = os.path.join(bin_dir, "manifest.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)
    f.write("\\n")
print("  buildId:", manifest["buildId"])
print("  assets:", ", ".join(assets.keys()))
PY

if [[ "${NOTIFY}" == "1" && -f "$ROOT/.env" ]]; then
	echo "Notifying online agents via websocket…"
	set -a
	# shellcheck disable=SC1091
	source "$ROOT/.env"
	set +a
	node --input-type=module <<'EOF' || echo "Notify skipped (agents will auto-update on heartbeat)" >&2
import { readFileSync } from "node:fs";
import { prisma } from "@fleet/db";
import { notifyAgent } from "./apps/api/dist/lib/agent-sockets.js";

const manifest = JSON.parse(readFileSync("agent/bin/manifest.json", "utf8"));
const agents = await prisma.agent.findMany({
  where: { status: "ONLINE" },
  select: { id: true, hostname: true },
});
for (const a of agents) {
  notifyAgent(a.id, { type: "upgrade_binary", buildId: manifest.buildId });
}
console.log(`Notified ${agents.length} online agent(s) (build ${manifest.buildId})`);
await prisma.$disconnect();
EOF
fi

echo ""
echo "Done. Agents auto-update on next heartbeat (~45s) or immediately if notified."
echo "  Manifest: curl -s http://127.0.0.1:4000/api/public/agent-manifest.json"
echo "  Fleet UI: Agents → Push binary update (or wait for auto-update)"
