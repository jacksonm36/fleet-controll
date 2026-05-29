#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node not found; run scripts/bootstrap-wsl.sh first" >&2
  exit 127
fi

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

LAN_IP="${FLEET_LAN_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
export API_UPSTREAM_URL="${API_UPSTREAM_URL:-http://127.0.0.1:${API_PORT:-4000}}"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://${LAN_IP:-127.0.0.1}:4000}"
export NODE_ENV="${NODE_ENV:-production}"
export PORT="${WEB_PORT:-3001}"
# Loopback only — public UI is https://FLEET_DOMAIN via nginx :443
export HOSTNAME="${WEB_HOST:-127.0.0.1}"

cd "$ROOT/apps/web"

web_mode="${FLEET_WEB_MODE:-production}"
if [[ "$web_mode" == "production" && ! -f "$ROOT/apps/web/.next/BUILD_ID" ]]; then
  echo "no production .next build; falling back to next dev" >&2
  web_mode="dev"
fi

if [[ "$web_mode" == "dev" ]]; then
  # Partial/failed production builds break dev (missing required-server-files.json).
  if [[ -d "$ROOT/apps/web/.next" && ! -f "$ROOT/apps/web/.next/BUILD_ID" ]]; then
    echo "removing corrupt .next cache" >&2
    rm -rf "$ROOT/apps/web/.next"
  fi
  export NODE_ENV=development
  exec npm run dev
fi

if [[ ! -f "$ROOT/apps/web/.next/BUILD_ID" ]]; then
  echo "building web (first run)…" >&2
  npm run build
fi

exec npx next start --port "${PORT}" --hostname "${HOSTNAME}"
