#!/usr/bin/env bash
# Ensure nginx TLS proxy exists for encrypted enrollment (idempotent).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLEET_DOMAIN="${FLEET_DOMAIN:-${FLEET_PUBLIC_HOST:-$(hostname -I 2>/dev/null | awk '{print $1}')}}"
FLEET_DOMAIN="${FLEET_DOMAIN:-localhost}"

if [[ "${FLEET_SKIP_TLS_SETUP:-0}" == "1" ]]; then
	echo "FLEET_SKIP_TLS_SETUP=1 — skipping TLS bootstrap"
	exit 0
fi

if [[ -f /etc/fleet/ca.crt ]] && systemctl is-active nginx >/dev/null 2>&1; then
	echo "TLS already configured (nginx active, CA at /etc/fleet/ca.crt)"
	exit 0
fi

if [[ "$(id -u)" -ne 0 ]]; then
	if command -v sudo >/dev/null 2>&1; then
		exec sudo FLEET_DOMAIN="$FLEET_DOMAIN" bash "$ROOT/scripts/setup-fleet-tls-nginx.sh"
	fi
	echo "TLS setup needs root — run: sudo FLEET_DOMAIN=$FLEET_DOMAIN bash scripts/setup-fleet-tls-nginx.sh" >&2
	exit 1
fi

export FLEET_DOMAIN
bash "$ROOT/scripts/setup-fleet-tls-nginx.sh"
