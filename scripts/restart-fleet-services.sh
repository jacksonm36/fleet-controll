#!/usr/bin/env bash
# Rebuild and restart Fleet controller services (API + web + nginx).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
fi

echo "--- bundling API (esbuild)"
mkdir -p "$ROOT/apps/api/dist"
npx esbuild "$ROOT/apps/api/src/server.ts" \
  --bundle \
  --platform=node \
  --format=esm \
  --packages=external \
  --outfile="$ROOT/apps/api/dist/server.js"

if [[ -f "$ROOT/apps/web/.next/BUILD_ID" ]] || [[ "${FLEET_WEB_MODE:-}" == "production" ]]; then
  echo "--- building web (next)"
  npm run build --workspace=@fleet/web
fi

echo "--- restarting systemd units"
if [[ "$(id -u)" -eq 0 ]]; then
  systemctl restart fleet-api.service fleet-web.service
  systemctl restart nginx.service 2>/dev/null || true
else
  sudo systemctl restart fleet-api.service fleet-web.service
  sudo systemctl restart nginx.service 2>/dev/null || true
fi

echo "--- status"
systemctl is-active fleet-api.service fleet-web.service || true
systemctl is-active nginx.service 2>/dev/null || true
echo "Done."
