#!/usr/bin/env bash
# Enable fleet-agent on boot (system unit for root, user unit otherwise).
# Called automatically at end of install — not usually run by hand.
#
set -euo pipefail

CENTRAL="$(printf '%s' "${FLEET_CENTRAL_URL:-}" | sed -e 's,/\+$,,')"
if [[ -z "$CENTRAL" ]]; then
	echo >&2 "set FLEET_CENTRAL_URL before running."
	exit 1
fi

if [[ ! -x "$HOME/.local/bin/fleet-agent" ]]; then
	echo >&2 "missing $HOME/.local/bin/fleet-agent"
	exit 1
fi

# __FLEET_TLS_HELPER_EMBED__
# __FLEET_SYSTEMD_EMBED__

fleet_agent_ensure_connected "$CENTRAL"
