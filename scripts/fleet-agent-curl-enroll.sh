#!/usr/bin/env bash
# Enroll linux fleet-agent using POST /api/agent/v1/enroll (curl + python3 JSON).
#
# Usage:
#   export FLEET_CENTRAL_URL=http://127.0.0.1:4000
#   ./fleet-agent-curl-enroll.sh --secret-file /path/to/one-line-secret   # deletes the file after read
#   ./fleet-agent-curl-enroll.sh '<plaintext>'
#
set -euo pipefail

PLAIN=""
SECRET_FILE=""
while [[ $# -gt 0 ]]; do
	case "$1" in
	--secret-file)
		SECRET_FILE="$2"
		shift 2
		;;
	-*)
		echo >&2 "unknown option: $1"
		exit 1
		;;
	*)
		if [[ -n "$PLAIN" ]]; then
			echo >&2 "usage: ${0##*/} <secret> | --secret-file <path>"
			exit 1
		fi
		PLAIN="$1"
		shift
		;;
	esac
done

if [[ -n "$PLAIN" && -n "$SECRET_FILE" ]]; then
	echo >&2 "use either plaintext arg or --secret-file, not both"
	exit 1
fi

if [[ -z "$PLAIN" ]]; then
	if [[ -z "$SECRET_FILE" || ! -f "$SECRET_FILE" ]]; then
		echo >&2 "missing pairing secret (--secret-file or plaintext arg)"
		exit 1
	fi
	PLAIN="$(tr -d '\r\n' <"$SECRET_FILE" || true)"
	rm -f "$SECRET_FILE"
fi

PLAIN="$(echo -n "$PLAIN" | tr -d '\r\n')"
if [[ -z "$PLAIN" ]]; then
	echo >&2 "empty pairing secret"
	exit 1
fi

CENTRAL="${FLEET_CENTRAL_URL:-}"
CENTRAL="$(printf '%s' "$CENTRAL" | sed -e 's,/\+$,,')"
if [[ -z "$CENTRAL" ]]; then
	echo >&2 "set FLEET_CENTRAL_URL (e.g. http://127.0.0.1:4000)"
	exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
	echo >&2 "python3 is required (installed by rust-agent-apt-root bootstrap)."
	exit 1
fi

TOKEN_FILE="${FLEET_AGENT_TOKEN_FILE:-$HOME/.fleet-agent.token}"
HOST="${HOSTNAME_OVERRIDE:-$(hostname)}"

export _ENROLL_PAIRING="$PLAIN"
export _ENROLL_HOST="$HOST"
BODY=$(python3 - <<'PY'
import json
import os
print(
    json.dumps(
        {
            "token": os.environ["_ENROLL_PAIRING"],
            "hostname": os.environ["_ENROLL_HOST"],
            "osType": "linux",
            "osDetail": "fleet-agent-curl-enroll.sh",
            "version": os.environ.get("FLEET_AGENT_VERSION", "0.2.0-rust"),
        }
    )
)
PY
)

unset _ENROLL_PAIRING _ENROLL_HOST

URL="${CENTRAL}/api/agent/v1/enroll"
RESP_BODY=$(curl -fsS -X POST "$URL" -H 'Content-Type: application/json' -d "$BODY")
API_TOKEN=$(printf '%s' "$RESP_BODY" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("apiToken",""))')

if [[ -z "$API_TOKEN" ]]; then
	echo >&2 "enroll parse failed — response: ${RESP_BODY:0:280}"
	exit 1
fi

mkdir -p "$(dirname "$TOKEN_FILE")"
umask 077
printf '%s' "$API_TOKEN" >"$TOKEN_FILE"

echo "Enrollment OK → $TOKEN_FILE"
