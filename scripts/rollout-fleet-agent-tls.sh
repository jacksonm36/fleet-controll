#!/usr/bin/env bash
# Central TLS + agent hardening rollout on the Fleet controller.
#
#   1. Rebuild agent binaries (TLS pin, ChaCha20 prefs)
#   2. Notify online agents to upgrade (websocket)
#   3. Queue SHELL_SCRIPT jobs to run fix-agent-connection.sh on each online host
#
#   bash scripts/rollout-fleet-agent-tls.sh
#   bash scripts/rollout-fleet-agent-tls.sh --skip-rebuild
#   bash scripts/rollout-fleet-agent-tls.sh --jobs-only
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_REBUILD=0
JOBS_ONLY=0
for arg in "$@"; do
	case "$arg" in
	--skip-rebuild) SKIP_REBUILD=1 ;;
	--jobs-only) JOBS_ONLY=1; SKIP_REBUILD=1 ;;
	*) echo "Unknown arg: $arg" >&2; exit 1 ;;
	esac
done

if [[ -f "$ROOT/.env" ]]; then
	set -a
	# shellcheck disable=SC1091
	source "$ROOT/.env"
	set +a
fi

PUBLIC="${FLEET_PUBLIC_URL:-}"
if [[ -z "$PUBLIC" ]]; then
	echo "Set FLEET_PUBLIC_URL in .env (e.g. https://192.168.1.178)" >&2
	exit 1
fi
PUBLIC="${PUBLIC%/}"

if [[ "$SKIP_REBUILD" != "1" ]]; then
	echo "=== Rebuilding fleet-agent binaries"
	NOTIFY=1 bash "$ROOT/scripts/rebuild-fleet-agent.sh"
else
	echo "=== Skipping rebuild (--skip-rebuild)"
fi

if [[ "$JOBS_ONLY" == "1" ]]; then
	echo "=== Queue TLS fix jobs only"
else
	echo "=== Waiting 15s for agents to pick up binary offer (optional)"
	sleep 15
fi

echo "=== Queue fix-agent-connection.sh on online agents"
cd "$ROOT"
node --input-type=module <<'EOF'
import { prisma } from "@fleet/db";
import {
  queueTlsRolloutJobs,
  tlsFixScriptForAgent,
} from "./apps/api/dist/lib/fleet-agent-tls-rollout.js";

const publicUrl = process.env.FLEET_PUBLIC_URL?.replace(/\/$/, "");
if (!publicUrl) {
  console.error("FLEET_PUBLIC_URL missing");
  process.exit(1);
}

const result = await queueTlsRolloutJobs(publicUrl);
console.log(`Queued ${result.queued} job(s), skipped ${result.skippedOffline} offline`);
console.log(`Fix script URL: ${publicUrl}/api/public/fix-agent-connection.sh`);
if (result.queued === 0) {
  console.log("No online agents — run fix script manually on hosts:");
  console.log(`  curl -fsSL '${publicUrl}/api/public/fix-agent-connection.sh' | bash`);
}
await prisma.$disconnect();
EOF

echo ""
echo "Done."
echo "  UI: Agents → check job logs; verify TLS in agent journal"
echo "  Per-host manual: curl -fsSL '${PUBLIC}/api/public/fix-agent-connection.sh' | bash"
