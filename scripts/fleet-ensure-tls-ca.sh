#!/usr/bin/env bash
# TLS helpers for agent install / enroll (sourced or embedded in served install scripts).

fleet_ensure_https_central() {
	local central="${1:-}"
	case "$central" in
	https://*) ;;
	*)
		echo >&2 "Fleet enrollment requires HTTPS. Controller URL: $central"
		echo >&2 "On the controller run: sudo bash scripts/setup-fleet-tls-nginx.sh" >&2
		echo >&2 "Then use: curl -fsSL 'https://YOUR_HOST/api/public/agent-install.sh' | FLEET_ENROLL_TOKEN='…' bash"
		return 1
		;;
	esac
}

# True when curl can reach the controller with the system trust store (public CA).
fleet_tls_trusted_by_system() {
	local probe_url="${1:-}"
	[[ -n "$probe_url" ]] || return 1
	if curl -fsSI --max-time 15 "$probe_url" >/dev/null 2>&1; then
		return 0
	fi
	return 1
}

fleet_ensure_ca_file() {
	local dest="${FLEET_CA_FILE:-${HOME}/.fleet/ca.crt}"
	if [[ -f "$dest" ]]; then
		export FLEET_CA_FILE="$dest"
		return 0
	fi
	local url="${FLEET_CA_DOWNLOAD_URL:-}"
	if [[ -z "$url" ]]; then
		return 1
	fi
	mkdir -p "$(dirname "$dest")"
	# First fetch of a self-signed controller cert must skip verification (-k).
	if ! curl -fsSLk "$url" -o "$dest"; then
		echo >&2 "Failed to download controller certificate from $url"
		return 1
	fi
	chmod 0644 "$dest"
	export FLEET_CA_FILE="$dest"
}

fleet_curl_tls_args() {
	# shellcheck disable=SC2034
	FLEET_CURL_TLS_ARGS=()
	if [[ -n "${FLEET_CA_FILE:-}" && -f "$FLEET_CA_FILE" ]]; then
		FLEET_CURL_TLS_ARGS=(--cacert "$FLEET_CA_FILE")
	fi
}

# Call once before any HTTPS curl to the controller (install, enroll, autostart).
fleet_prepare_tls() {
	local central="${1:-}"
	central="$(printf '%s' "$central" | sed -e 's,/\+$,,')"

	case "$central" in
	http://*)
		if [[ "${FLEET_REQUIRE_TLS_BOOTSTRAP:-0}" == "1" ]]; then
			local host="${central#http://}"
			host="${host%%/*}"
			host="${host%%:*}"
			central="https://${host}"
		fi
		;;
	esac

	fleet_ensure_https_central "$central" || return 1

	export FLEET_CA_DOWNLOAD_URL="${FLEET_CA_DOWNLOAD_URL:-${central}/api/public/tls-ca.crt}"

	local probe="${central}/api/public/tls-ca.crt"
	if fleet_tls_trusted_by_system "$probe"; then
		unset FLEET_CA_FILE 2>/dev/null || true
		fleet_curl_tls_args
		echo "--- TLS: controller certificate trusted by system CA store"
		return 0
	fi

	echo "--- TLS: downloading controller certificate for agent trust"
	if ! fleet_ensure_ca_file; then
		echo >&2 "Could not verify or download controller certificate."
		echo >&2 "  URL: ${FLEET_CA_DOWNLOAD_URL}"
		return 1
	fi
	fleet_curl_tls_args
	echo "--- TLS: using FLEET_CA_FILE=${FLEET_CA_FILE}"
	return 0
}
