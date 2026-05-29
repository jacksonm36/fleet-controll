#!/usr/bin/env bash
# Install Fleet controller as systemd units (API + Web).
#
#   sudo bash scripts/install-fleet-systemd.sh
#
# Environment:
#   FLEET_ROOT   repo path (default: parent of scripts/)
#   FLEET_USER   unix user to run services (default: invoking user if sudo, else $USER)
#   FLEET_BUILD  1 = try production builds (default: 0; API uses tsx, web uses dev if build fails)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLEET_ROOT="${FLEET_ROOT:-$ROOT}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo: sudo bash $FLEET_ROOT/scripts/install-fleet-systemd.sh" >&2
  exit 1
fi

_invoke_user="${SUDO_USER:-${USER:-root}}"
FLEET_USER="${FLEET_USER:-$_invoke_user}"
FLEET_GROUP="$(id -gn "$FLEET_USER" 2>/dev/null || echo "$FLEET_USER")"
FLEET_HOME="$(getent passwd "$FLEET_USER" | cut -d: -f6)"
FLEET_BUILD="${FLEET_BUILD:-0}"

if [[ ! -f "$FLEET_ROOT/.env" ]]; then
  echo "Missing $FLEET_ROOT/.env — run scripts/bootstrap-wsl.sh first." >&2
  exit 1
fi

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -n "$LAN_IP" ]]; then
  grep -q '^NEXT_PUBLIC_API_URL=' "$FLEET_ROOT/.env" 2>/dev/null || true
  mkdir -p "$FLEET_ROOT/apps/web"
  printf '%s\n' "NEXT_PUBLIC_API_URL=http://${LAN_IP}:4000" > "$FLEET_ROOT/apps/web/.env.local"
  chown "$FLEET_USER:$FLEET_GROUP" "$FLEET_ROOT/apps/web/.env.local" 2>/dev/null || true
fi

chmod +x "$FLEET_ROOT/scripts/systemd/fleet-api.sh" "$FLEET_ROOT/scripts/systemd/fleet-web.sh"
chown -R "$FLEET_USER:$FLEET_GROUP" "$FLEET_ROOT"

echo "--- ensuring postgres + redis"
systemctl enable postgresql redis-server 2>/dev/null || true
systemctl start postgresql redis-server 2>/dev/null || true

if [[ "$FLEET_BUILD" == "1" ]]; then
  echo "--- production build (as $FLEET_USER)"
  sudo -u "$FLEET_USER" bash -lc "
    set -e
    export NVM_DIR=\"\${NVM_DIR:-\$HOME/.nvm}\"
    [[ -s \"\$NVM_DIR/nvm.sh\" ]] && . \"\$NVM_DIR/nvm.sh\"
    cd \"$FLEET_ROOT\"
    npx turbo run build --filter=@fleet/db --filter=@fleet/types --filter=@fleet/ui
    npm run build --workspace=@fleet/api || echo 'API tsc skipped (tsx runtime)'
    npm run build --workspace=@fleet/web || echo 'Web build skipped (dev mode)'
  " || true
fi

FLEET_WEB_MODE="production"
if [[ ! -f "$FLEET_ROOT/apps/web/.next/BUILD_ID" ]]; then
  FLEET_WEB_MODE="dev"
  echo "--- web: no production build; unit will use FLEET_WEB_MODE=dev"
fi

render_unit() {
  local src="$1" dest="$2"
  sed \
    -e "s|@FLEET_ROOT@|${FLEET_ROOT}|g" \
    -e "s|@FLEET_USER@|${FLEET_USER}|g" \
    -e "s|@FLEET_GROUP@|${FLEET_GROUP}|g" \
    -e "s|@FLEET_HOME@|${FLEET_HOME}|g" \
    -e "s|@FLEET_WEB_MODE@|${FLEET_WEB_MODE}|g" \
    "$src" >"$dest"
}

echo "--- installing units to /etc/systemd/system"
render_unit "$FLEET_ROOT/deploy/systemd/fleet-api.service" /etc/systemd/system/fleet-api.service
render_unit "$FLEET_ROOT/deploy/systemd/fleet-web.service" /etc/systemd/system/fleet-web.service
render_unit "$FLEET_ROOT/deploy/systemd/fleet-controller.target" /etc/systemd/system/fleet-controller.target

systemctl daemon-reload
systemctl enable fleet-controller.target
# Stop stray dev servers that would hold :3000 before the unit starts.
pkill -f 'next dev --port 3000' 2>/dev/null || true
pkill -f 'next-server' 2>/dev/null || true
sleep 1
systemctl restart fleet-api.service fleet-web.service

for _ in $(seq 1 45); do
  if curl -sf "http://127.0.0.1:4000/health" >/dev/null 2>&1; then
    echo ""
    echo "SYSTEMD_OK"
    echo "  systemctl status fleet-api.service fleet-web.service"
    echo "  journalctl -u fleet-api -u fleet-web -f"
    if [[ -n "$LAN_IP" ]]; then
      echo "  Web: http://${LAN_IP}:3000"
      echo "  API: http://${LAN_IP}:4000/health"
    fi
    exit 0
  fi
  sleep 1
done

echo "Services enabled but API health check failed. Logs:" >&2
journalctl -u fleet-api -n 40 --no-pager >&2 || true
exit 1
