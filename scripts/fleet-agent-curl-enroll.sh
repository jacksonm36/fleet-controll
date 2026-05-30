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

# Injected when served from Fleet API /api/public/agent-enroll.sh
FLEET_CENTRAL_DEFAULT="${FLEET_CENTRAL_DEFAULT:-}"

CENTRAL="${FLEET_CENTRAL_URL:-}"
if [[ -z "$CENTRAL" && -n "$FLEET_CENTRAL_DEFAULT" ]]; then
	CENTRAL="$FLEET_CENTRAL_DEFAULT"
fi
CENTRAL="$(printf '%s' "$CENTRAL" | sed -e 's,/\+$,,')"
if [[ -z "$CENTRAL" ]]; then
	echo >&2 "set FLEET_CENTRAL_URL (e.g. https://192.168.1.178)"
	exit 1
fi

# Injected when served from Fleet API
FLEET_CA_DOWNLOAD_URL="${FLEET_CA_DOWNLOAD_URL:-}"

# __FLEET_TLS_HELPER_EMBED__

SCRIPT_TLS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/fleet-ensure-tls-ca.sh"
# shellcheck disable=SC1091
[[ -f "$SCRIPT_TLS" ]] && source "$SCRIPT_TLS"
fleet_prepare_tls "$CENTRAL"
fleet_curl_tls_args

if ! command -v python3 >/dev/null 2>&1; then
	echo >&2 "python3 is required (installed by rust-agent-apt-root bootstrap)."
	exit 1
fi

TOKEN_FILE="${FLEET_AGENT_TOKEN_FILE:-$HOME/.fleet-agent.token}"
HOST="$(printf '%s' "${HOSTNAME_OVERRIDE:-$(hostname -s 2>/dev/null || hostname)}")"
HOST="${HOST//$'\r'/}"
HOST="${HOST//$'\n'/}"
HOST="${HOST#"${HOST%%[![:space:]]*}"}"
HOST="${HOST%"${HOST##*[![:space:]]}"}"

export _ENROLL_PAIRING="$PLAIN"
export _ENROLL_HOST="$HOST"
export _FLEET_HOSTNAME="${FLEET_HOSTNAME:-}"
BODY=$(python3 - <<'PY'
import json
import os
import re
from pathlib import Path

HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
MAX_OS_DETAIL = 512
MAX_HOST = 128


def normalize_hostname(raw: str) -> str:
    h = (raw or "").strip().rstrip(".")
    if not h:
        h = "fleet-host"
    if len(h) > MAX_HOST:
        h = h[:MAX_HOST]
    if HOST_RE.match(h):
        return h
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", h).strip("-._")
    if not cleaned or not cleaned[0].isalnum():
        cleaned = f"fleet-host-{cleaned or 'node'}"
    cleaned = cleaned[:MAX_HOST]
    if HOST_RE.match(cleaned):
        return cleaned
    return "fleet-host"


os_detail = ""
os_type = "linux"
try:
    os_detail = Path("/etc/os-release").read_text(encoding="utf-8", errors="replace").strip()
    if not os_detail and Path("/usr/lib/os-release").exists():
        os_detail = Path("/usr/lib/os-release").read_text(encoding="utf-8", errors="replace").strip()
except OSError:
    pass
if not os_detail:
    u = os.uname()
    os_detail = f"NAME={u.sysname}\nPRETTY_NAME={u.sysname} {u.release}\nVERSION_ID={u.release}\nID=linux"
    os_type = u.sysname.lower() if u.sysname.lower() in ("linux", "freebsd", "openbsd", "netbsd") else "linux"
if len(os_detail) > MAX_OS_DETAIL:
    os_detail = os_detail[:MAX_OS_DETAIL]

host = normalize_hostname(os.environ.get("_ENROLL_HOST", ""))
payload = {
    "token": os.environ["_ENROLL_PAIRING"],
    "hostname": host,
    "osType": os_type,
    "osDetail": os_detail,
    "version": os.environ.get("FLEET_AGENT_VERSION", "0.3.0-go")[:64],
}
fleet = os.environ.get("_FLEET_HOSTNAME", "").strip()
if fleet:
    payload["fleetHostname"] = normalize_hostname(fleet)

print(json.dumps(payload))
PY
)

unset _ENROLL_PAIRING _ENROLL_HOST _FLEET_HOSTNAME

URL="${CENTRAL}/api/agent/v1/enroll"
HTTP_CODE=$(curl -sS "${FLEET_CURL_TLS_ARGS[@]}" -o /tmp/fleet-enroll-resp.json -w '%{http_code}' \
	-X POST "$URL" -H 'Content-Type: application/json' -d "$BODY")
RESP_BODY=$(cat /tmp/fleet-enroll-resp.json 2>/dev/null || true)
rm -f /tmp/fleet-enroll-resp.json

if [[ "$HTTP_CODE" != "200" ]]; then
	echo >&2 "enroll failed HTTP $HTTP_CODE — ${RESP_BODY:-empty}"
	if [[ "$RESP_BODY" == *"invalid_body"* ]]; then
		echo >&2 "Request rejected (hostname/osDetail). Try: HOSTNAME_OVERRIDE=my-mail-host $0 …" >&2
		echo >&2 "  hostname sent: ${HOST:-unknown}" >&2
	elif [[ "$HTTP_CODE" == "409" ]]; then
		echo >&2 "Enrollment conflict — token was NOT consumed. Fix the issue below, then retry with the same token." >&2
		if [[ "$RESP_BODY" == *"agent_ip_conflict"* ]] || [[ "$RESP_BODY" == *"already"* ]]; then
			echo >&2 "  Set FLEET_HOSTNAME to the name shown in Fleet → Agents, or delete the stale agent." >&2
		fi
	elif [[ "$RESP_BODY" == *"invalid_or_expired_token"* ]]; then
		echo >&2 "Token already used or wrong. Mint a NEW token in Fleet → Enrollment." >&2
	elif [[ "$RESP_BODY" == *"tls_required"* ]]; then
		echo >&2 "Controller requires HTTPS. Use https:// in FLEET_CENTRAL_URL or run: sudo bash scripts/setup-fleet-tls-nginx.sh" >&2
		echo >&2 "Lab-only HTTP for all agent traffic: set FLEET_REQUIRE_TLS=0 on the controller and FLEET_ALLOW_INSECURE_HTTP=1 on the agent." >&2
	fi
	exit 1
fi

API_TOKEN=$(printf '%s' "$RESP_BODY" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("apiToken",""))')

if [[ -z "$API_TOKEN" ]]; then
	echo >&2 "enroll parse failed — response: ${RESP_BODY:0:280}"
	exit 1
fi

mkdir -p "$(dirname "$TOKEN_FILE")"
umask 077
printf '%s' "$API_TOKEN" >"$TOKEN_FILE"

echo "Enrollment OK → $TOKEN_FILE"
