#!/usr/bin/env bash
# Print FLEET_CENTRAL_URL for agents in WSL2 (delegates to fleet-discover-central.sh).

set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--prefer-localhost-first" ]]; then
	exec bash "$DIR/fleet-discover-central.sh" --prefer-localhost-first
fi

exec bash "$DIR/fleet-discover-central.sh"
