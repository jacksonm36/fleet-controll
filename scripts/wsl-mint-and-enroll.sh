#!/usr/bin/env bash
# Mint a one-time enrollment secret via Fleet operator login, then enroll (curl → ~/.fleet-agent.token).
# Usage (from WSL or: wsl -d Ubuntu-22.04 -- env … bash …):
#   export FLEET_OPERATOR_EMAIL=admin@localhost
#   export FLEET_OPERATOR_PASSWORD='your-password'
#   export FLEET_CENTRAL_URL=http://127.0.0.1:4000   # optional
#   bash /mnt/d/manager/scripts/wsl-mint-and-enroll.sh

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for f in "$DIR/wsl-api-mint-enrollment-token.sh" "$DIR/fleet-agent-curl-enroll.sh" "$DIR/wsl-mint-and-enroll.sh"; do
	sed -i 's/\r$//' "$f" 2>/dev/null || true
done

set -euo pipefail
export FLEET_CENTRAL_URL="${FLEET_CENTRAL_URL:-http://127.0.0.1:4000}"

: "${FLEET_OPERATOR_EMAIL:?Set FLEET_OPERATOR_EMAIL}"
: "${FLEET_OPERATOR_PASSWORD:?Set FLEET_OPERATOR_PASSWORD}"

PAIR="$(bash "$DIR/wsl-api-mint-enrollment-token.sh")"
bash "$DIR/fleet-agent-curl-enroll.sh" "$PAIR"
