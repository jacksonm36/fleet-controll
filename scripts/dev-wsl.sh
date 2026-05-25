#!/usr/bin/env bash
# Turbo dev under WSL — sources nvm (non-login shells omit it).

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi

if ! command -v node >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Node.js not found in this WSL session.

Fix (Debian, user jackson):
  bash /mnt/d/manager/scripts/bootstrap-wsl.sh

Or from Windows:
  scripts\run-bootstrap-wsl.cmd

Then start dev:
  scripts\run-dev-wsl.cmd
EOF
  exit 127
fi

echo "Starting Fleet dev (Node $(node -v)) — web :3000, API :4000"
exec npm run dev
