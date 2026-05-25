#!/usr/bin/env bash
# Mint a Fleet pairing secret from WSL/Linux using curl + Python (no PowerShell).
# Uses the operator login that matches your Fleet seed / UI account.
#
# Usage:
#   export FLEET_OPERATOR_EMAIL='admin@localhost'
#   export FLEET_OPERATOR_PASSWORD='actual-password-characters-no-brackets'
#   export FLEET_CENTRAL_URL='http://127.0.0.1:4000'   # optional
#   bash /mnt/d/manager/scripts/wsl-api-mint-enrollment-token.sh
#
# Scripts on /mnt/d/ may have CRLF from Windows editors — strip first:
#   sed -i 's/\r$//' /mnt/d/manager/scripts/wsl-api-mint-enrollment-token.sh
#
# Default seed password (until you change it): changeme123
#
# Prints ONE line: plaintext enrollment secret — single use with fleet-agent.

set -euo pipefail

API="${FLEET_CENTRAL_URL:-http://127.0.0.1:4000}"
API="${API%/}"

: "${FLEET_OPERATOR_EMAIL:?Set FLEET_OPERATOR_EMAIL}"
: "${FLEET_OPERATOR_PASSWORD:?Set FLEET_OPERATOR_PASSWORD}"

LOGIN_JSON=$(python3 <<'PY'
import json, os

print(
    json.dumps(
        {"email": os.environ["FLEET_OPERATOR_EMAIL"], "password": os.environ["FLEET_OPERATOR_PASSWORD"]}
    )
)
PY
)

L=$(mktemp)
M=$(mktemp)
trap 'rm -f "$L" "$M"' EXIT

LOGIN_HTTP=$(curl -sS -o "$L" -w "%{http_code}" \
	-X POST "$API/api/auth/login" \
	-H 'Content-Type: application/json' \
	--data-binary "$LOGIN_JSON")
if [[ "$LOGIN_HTTP" != "200" ]]; then
	echo "Login failed HTTP $LOGIN_HTTP." >&2
	echo "Body: $(cat "$L")" >&2
	echo >&2
	echo "Use the same email/password as the Fleet web app. Do NOT paste placeholders like '<real-login-password>'." >&2
	echo "Fresh DB seed is often admin@localhost + changeme123 (see packages/db prisma seed)." >&2
	exit 1
fi

JWT=$(python3 -c "import sys, json; print(json.load(sys.stdin)['token'])" < "$L")

MINT_HTTP=$(curl -sS -o "$M" -w "%{http_code}" \
	-X POST "$API/api/enrollment-tokens" \
	-H "Authorization: Bearer $JWT" \
	-H 'Content-Type: application/json' \
	-d '{"ttlMinutes":720}')
if [[ "$MINT_HTTP" != "200" ]]; then
	echo "Mint enrollment token failed HTTP $MINT_HTTP." >&2
	echo "Body: $(cat "$M")" >&2
	echo >&2
	echo "You must be ADMIN/OPERATOR (not VIEWER) to mint." >&2
	exit 1
fi

python3 -c "import sys, json; print(json.load(sys.stdin)['token'])" < "$M"
