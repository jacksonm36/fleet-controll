#!/usr/bin/env bash
# WSL: Node via NVM (no sudo), Postgres must already listen on DATABASE_URL (.env).
# Interactive sudo is only needed once for Postgres (commands printed if DB check fails).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

fetch_url() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$url"
  else
    cat >&2 <<'NEEDTOOLS'
Neither curl nor wget is installed in WSL. Run once:

  sudo apt update
  sudo apt install -y curl ca-certificates openssl postgresql postgresql-contrib postgresql-client
  sudo service postgresql start
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE fleet LOGIN PASSWORD 'fleet';" 2>/dev/null || true
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE fleet OWNER fleet;" 2>/dev/null || true

Then:

  bash /mnt/d/manager/scripts/bootstrap-wsl.sh

(Or from Windows:)  scripts\run-bootstrap-wsl.cmd

NEEDTOOLS
    exit 127
  fi
}

ensure_node_via_nvm() {
  # shellcheck disable=SC1090
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    . "$NVM_DIR/nvm.sh"
  fi
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -e "console.log(process.version.slice(1).split('.')[0])")"
    if [[ "$major" -ge 20 ]]; then
      echo "Using Node $(node -v)"
      return 0
    fi
  fi

  echo "Installing nvm + Node.js 20 under \$HOME (no sudo)..." >&2
  fetch_url "https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh" | bash
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm alias default 20
  echo "Using Node $(node -v)"
}

ensure_node_via_nvm

write_env_maybe() {
  if [[ "${SKIP_BOOTSTRAP_ENV:-0}" == "1" ]]; then
    return 0
  fi
  local jwt seed_pw
  jwt="$(openssl rand -hex 48)"
  seed_pw="$(openssl rand -hex 18)"
  cat > .env <<EOF
DATABASE_URL="postgresql://fleet:fleet@127.0.0.1:5432/fleet?schema=public"
REDIS_URL="redis://127.0.0.1:6379"
JWT_SECRET="${jwt}"
API_PORT=4000
NEXT_PUBLIC_API_URL="http://127.0.0.1:4000"
CORS_ORIGIN="http://localhost:3000,http://127.0.0.1:3000"

SEED_ADMIN_EMAIL="admin@localhost"
SEED_ADMIN_PASSWORD="${seed_pw}"
EOF
  mkdir -p apps/web
  printf '%s\n' 'NEXT_PUBLIC_API_URL=http://127.0.0.1:4000' > apps/web/.env.local
}

write_env_maybe

require_postgres() {
  command -v psql >/dev/null 2>&1 || {
    echo >&2 "psql missing. Install: sudo apt update && sudo apt install -y postgresql-client postgresql && sudo service postgresql start"
    exit 1
  }

  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a

  # Strip CR if .env was edited on Windows
  DATABASE_URL="${DATABASE_URL//$'\r'/}"

  if PGPASSWORD=fleet psql -h 127.0.0.1 -p 5432 -U fleet -d fleet -c "SELECT 1" >/dev/null 2>&1; then
    return 0
  fi

  if psql "${DATABASE_URL}" -c "SELECT 1" >/dev/null 2>&1; then
    return 0
  fi

  cat >&2 <<'SETUP'
PostgreSQL refused connection using DATABASE_URL in .env.
Run ONCE inside WSL (will prompt for sudo password):

  sudo apt update
  sudo apt install -y postgresql postgresql-contrib
  sudo service postgresql start
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE fleet LOGIN PASSWORD 'fleet';" 2>/dev/null || true
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE fleet OWNER fleet;" 2>/dev/null || true

Then re-run:
  bash /mnt/d/manager/scripts/bootstrap-wsl.sh
SETUP

  exit 1
}

require_postgres

echo "--- npm install"
npm install

echo "--- build workspace packages (dist for @fleet/db, @fleet/types, @fleet/ui)"
npx turbo run build --filter=@fleet/db --filter=@fleet/types --filter=@fleet/ui

echo "--- prisma db push"
npm run db:push

echo "--- db seed"
npm run db:seed

echo "--- API health smoke (temporary server)"
npm run dev --workspace=@fleet/api > /tmp/fleet-api-test.log 2>&1 &
echo $! >/tmp/fleet-api-test.pid

for _ in $(seq 1 45); do
  if curl -sf http://127.0.0.1:4000/health >/dev/null 2>&1; then
    echo "health ok: GET /health"
    kill "$(cat /tmp/fleet-api-test.pid)" 2>/dev/null || true
    sleep 1
    echo "--- done"
    echo "Repo .env / apps/web/.env.local under: $ROOT"
    echo "Start stack: cd $ROOT && npm run dev"
    echo "Login: see SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in $ROOT/.env"
    exit 0
  fi
  sleep 1
done

echo >&2 "API did not respond. Log (/tmp/fleet-api-test.log):"
cat /tmp/fleet-api-test.log || true
kill "$(cat /tmp/fleet-api-test.pid)" 2>/dev/null || true
exit 1
