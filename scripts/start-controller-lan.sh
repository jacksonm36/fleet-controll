#!/usr/bin/env bash
# Start Fleet API + web bound for LAN access (0.0.0.0).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"

LAN_IP="${FLEET_LAN_IP:-$(hostname -I | awk '{print $1}')}"
if [[ -z "$LAN_IP" ]]; then
  echo "Could not detect LAN IP; set FLEET_LAN_IP." >&2
  exit 1
fi

if [[ "${SKIP_BOOTSTRAP_ENV:-0}" != "1" ]]; then
  jwt="$(openssl rand -hex 48)"
  seed_pw="$(openssl rand -hex 18)"
  cat > .env <<EOF
DATABASE_URL="postgresql://fleet:fleet@127.0.0.1:5432/fleet?schema=public"
REDIS_URL="redis://127.0.0.1:6379"
JWT_SECRET="${jwt}"
API_PORT=4000
FLEET_PUBLIC_HOST="${LAN_IP}"
FLEET_AUTO_ENCRYPT=1
FLEET_REQUIRE_TLS=1
TRUST_PROXY=1
NEXT_PUBLIC_API_URL="https://${LAN_IP}"
CORS_ORIGIN="https://${LAN_IP}"

SEED_ADMIN_EMAIL="admin@localhost"
SEED_ADMIN_PASSWORD="${seed_pw}"
EOF
  mkdir -p apps/web
  printf '%s\n' "NEXT_PUBLIC_API_URL=https://${LAN_IP}" > apps/web/.env.local
fi

if [[ "${FLEET_SKIP_TLS_SETUP:-0}" != "1" ]]; then
  echo "--- TLS (encrypted enrollment)"
  FLEET_DOMAIN="${FLEET_PUBLIC_HOST:-$LAN_IP}" bash "$ROOT/scripts/fleet-tls-bootstrap.sh" || true
fi

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running --quiet 2>/dev/null; then
  systemctl start redis-server postgresql 2>/dev/null || true
else
  service redis-server start 2>/dev/null || true
  service postgresql start 2>/dev/null || true
fi

use_systemd=0
if [[ "${FLEET_USE_SYSTEMD:-1}" == "1" ]] && command -v systemctl >/dev/null 2>&1; then
  if systemctl list-unit-files fleet-controller.target >/dev/null 2>&1; then
    use_systemd=1
  fi
fi

if [[ "$use_systemd" -eq 1 ]]; then
  echo "--- starting via systemd (fleet-controller.target)"
  if [[ "$(id -u)" -eq 0 ]]; then
    systemctl restart fleet-api.service fleet-web.service
  elif command -v sudo >/dev/null 2>&1; then
    sudo systemctl restart fleet-api.service fleet-web.service
  else
    systemctl --user restart fleet-api.service fleet-web.service 2>/dev/null || use_systemd=0
  fi
fi

if [[ "$use_systemd" -eq 0 ]]; then
  pkill -f 'node --import tsx src/server.ts' 2>/dev/null || true
  pkill -f 'next dev --port 3000' 2>/dev/null || true
  pkill -f 'next start --port 3000' 2>/dev/null || true
  sleep 1
  chmod +x "$ROOT/scripts/systemd/fleet-api.sh" "$ROOT/scripts/systemd/fleet-web.sh"
  FLEET_WEB_MODE=dev nohup "$ROOT/scripts/systemd/fleet-api.sh" >> /tmp/fleet-api.log 2>&1 &
  echo $! >/tmp/fleet-api.pid
  FLEET_WEB_MODE=dev nohup "$ROOT/scripts/systemd/fleet-web.sh" >> /tmp/fleet-web.log 2>&1 &
  echo $! >/tmp/fleet-web.pid
fi

for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:4000/health" >/dev/null && curl -sf -o /dev/null "http://127.0.0.1:3000/"; then
    redis_ok="down"
    if redis-cli ping 2>/dev/null | grep -q PONG; then
      redis_ok="up"
    fi
    echo "FLEET_OK"
    echo "Web:  https://${LAN_IP}  (or http://${LAN_IP}:3000 before TLS)"
    echo "API:  https://${LAN_IP}/health"
    echo "Redis: ${redis_ok} (127.0.0.1:6379)"
    echo "Mode: $([[ "$use_systemd" -eq 1 ]] && echo systemd || echo manual)"
    echo "Admin: ${SEED_ADMIN_EMAIL} / see SEED_ADMIN_PASSWORD in $ROOT/.env"
    exit 0
  fi
  sleep 1
done

echo "Fleet did not become ready." >&2
if [[ "$use_systemd" -eq 1 ]]; then
  journalctl -u fleet-api -u fleet-web -n 30 --no-pager >&2 || true
else
  echo "Logs: /tmp/fleet-api.log /tmp/fleet-web.log" >&2
fi
exit 1
