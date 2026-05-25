#!/usr/bin/env bash
# Probe Fleet API /health and print the first working FLEET_CENTRAL_URL (no trailing slash).
#
# Usage:
#   export FLEET_CENTRAL_URL="$(bash fleet-discover-central.sh)"
#   bash fleet-discover-central.sh --prefer-localhost-first
#
# Environment:
#   FLEET_CENTRAL_URL   if set and healthy, use as-is
#   FLEET_API_PORT      default 4000
#   FLEET_DISCOVER_TIMEOUT_SEC  per-probe timeout (default 2)

set -euo pipefail

PORT="${FLEET_API_PORT:-4000}"
TIMEOUT="${FLEET_DISCOVER_TIMEOUT_SEC:-2}"

health_ok() {
	local base="${1%/}"
	if command -v curl >/dev/null 2>&1; then
		curl -sf --max-time "$TIMEOUT" "${base}/health" 2>/dev/null | grep -q '"ok"[[:space:]]*:[[:space:]]*true'
		return $?
	fi
	if command -v wget >/dev/null 2>&1; then
		wget -qO- --timeout="$TIMEOUT" "${base}/health" 2>/dev/null | grep -q '"ok"[[:space:]]*:[[:space:]]*true'
		return $?
	fi
	return 1
}

emit_if_ok() {
	local base="$1"
	if health_ok "$base"; then
		printf '%s\n' "${base%/}"
		return 0
	fi
	return 1
}

if [[ "${1:-}" == "--prefer-localhost-first" ]]; then
	emit_if_ok "http://127.0.0.1:${PORT}" && exit 0
	emit_if_ok "http://localhost:${PORT}" && exit 0
fi

if [[ -n "${FLEET_CENTRAL_URL:-}" ]]; then
	emit_if_ok "${FLEET_CENTRAL_URL}" && exit 0
fi

# Common local / mirrored networking (WSL2, same host)
for host in 127.0.0.1 localhost; do
	emit_if_ok "http://${host}:${PORT}" && exit 0
done

# WSL / Docker Desktop: Windows host via resolv.conf nameserver
if [[ -r /etc/resolv.conf ]]; then
	ns="$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf 2>/dev/null || true)"
	if [[ -n "$ns" && "$ns" != "127.0.0.1" ]]; then
		emit_if_ok "http://${ns}:${PORT}" && exit 0
	fi
fi

# Default route gateway (LAN controller)
if command -v ip >/dev/null 2>&1; then
	gw="$(ip route show default 2>/dev/null | awk '{print $3; exit}' || true)"
	if [[ -n "$gw" ]]; then
		emit_if_ok "http://${gw}:${PORT}" && exit 0
	fi
fi

# Primary IPv4 on this host (agent advertises same subnet)
if command -v hostname >/dev/null 2>&1; then
	for ip in $(hostname -I 2>/dev/null || true); do
		[[ -n "$ip" ]] || continue
		emit_if_ok "http://${ip}:${PORT}" && exit 0
	done
fi

echo "Could not find Fleet API on port ${PORT} (tried localhost, WSL gateway, default route)." >&2
echo "Set FLEET_CENTRAL_URL explicitly, e.g. export FLEET_CENTRAL_URL=http://your-controller:4000" >&2
exit 1
