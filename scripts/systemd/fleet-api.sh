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

export NODE_ENV="${NODE_ENV:-production}"

cd "$ROOT/apps/api"
if [[ -f dist/server.js ]]; then
  exec node dist/server.js
fi
exec node --import tsx src/server.ts
