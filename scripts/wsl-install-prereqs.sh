#!/usr/bin/env bash
# Run as WSL root: apt install curl + Postgres, start clusters, create fleet role/DB. Idempotent.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  openssl \
  postgresql \
  postgresql-client \
  postgresql-contrib \
  redis-server

# Ensure server is up (WSL may not use systemd the same way as bare metal).
if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running --quiet 2>/dev/null; then
  systemctl enable postgresql 2>/dev/null || true
  systemctl restart postgresql 2>/dev/null || true
  systemctl enable redis-server 2>/dev/null || true
  systemctl restart redis-server 2>/dev/null || true
else
  service postgresql start 2>/dev/null || true
  service redis-server start 2>/dev/null || true
fi

# Debian/Ubuntu: start every registered cluster (e.g. 17 main).
if command -v pg_ctlcluster >/dev/null 2>&1; then
  while read -r ver name _; do
    [[ -n "$ver" && -n "$name" ]] || continue
    pg_ctlcluster "$ver" "$name" start 2>/dev/null || true
  done < <(pg_lsclusters --no-header || true)
fi

# Wait for TCP (Prisma / psql URI use 127.0.0.1).
for _ in $(seq 1 45); do
  if command -v pg_isready >/dev/null 2>&1 && pg_isready -q -h 127.0.0.1 -p 5432 2>/dev/null; then
    break
  fi
  sleep 1
done

if ! pg_isready -q -h 127.0.0.1 -p 5432 2>/dev/null; then
  echo "Postgres did not become ready on 127.0.0.1:5432" >&2
  pg_lsclusters || true
  exit 1
fi

if ! su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='fleet'\"" | grep -q 1; then
  su - postgres -c "psql -v ON_ERROR_STOP=1 -c \"CREATE ROLE fleet LOGIN PASSWORD 'fleet';\""
fi

if ! su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='fleet'\"" | grep -q 1; then
  su - postgres -c "psql -v ON_ERROR_STOP=1 -c \"CREATE DATABASE fleet OWNER fleet;\""
fi

# Allow fleet to use the public schema (Prisma default).
su - postgres -c "psql -v ON_ERROR_STOP=1 -d fleet -c \"GRANT ALL ON SCHEMA public TO fleet;\"" 2>/dev/null || true

echo "PREREQS_OK"
