#!/usr/bin/env bash
# Re-apply agent TLS + systemd + verify (install does this automatically).
set -eo pipefail

FLEET_DISCOVER_HOST="${FLEET_DISCOVER_HOST:-}"
FLEET_HTTPS_PUBLIC_URL="${FLEET_HTTPS_PUBLIC_URL:-}"
HOST="${1:-${FLEET_DISCOVER_HOST:-}}"
if [[ -z "$HOST" ]]; then
  echo "Usage: FLEET_DISCOVER_HOST=controller.example.com $0" >&2
  echo "   or: $0 controller.example.com" >&2
  exit 1
fi
HOST="${HOST#https://}"
HOST="${HOST#http://}"
HOST="${HOST%%/*}"
HOST="${HOST%%:*}"
CENTRAL="https://${HOST}"

# __FLEET_TLS_HELPER_EMBED__
# __FLEET_SCANNERS_EMBED__
# __FLEET_SYSTEMD_EMBED__

export FLEET_DISCOVER_HOST="$HOST"
export FLEET_CENTRAL_URL="$CENTRAL"
export FLEET_CA_DOWNLOAD_URL="${FLEET_CA_DOWNLOAD_URL:-${CENTRAL}/api/public/tls-ca.crt}"

# Do not run apt/scanner installs here — only TLS + systemd reconnect.
if declare -F _fleet_report_container_cli >/dev/null 2>&1; then
	_fleet_report_container_cli || true
fi

fleet_agent_ensure_connected "$CENTRAL"
