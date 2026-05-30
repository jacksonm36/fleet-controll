#!/usr/bin/env bash
# Shared agent runtime: TLS CA, env, systemd (system unit for root), verify heartbeats.
#
# Sourced / embedded by install-fleet-agent.sh, fix-agent-connection.sh, wsl-fleet-agent-autostart.sh

fleet_agent_api_host() {
	local host="${FLEET_DISCOVER_HOST:-}"
	if [[ -z "$host" && -n "${FLEET_HTTPS_PUBLIC_URL:-}" ]]; then
		host="${FLEET_HTTPS_PUBLIC_URL#https://}"
		host="${host%%/*}"
		host="${host%%:*}"
	fi
	if [[ -z "$host" && -n "${FLEET_CENTRAL_URL:-}" ]]; then
		host="${FLEET_CENTRAL_URL#https://}"
		host="${host#http://}"
		host="${host%%/*}"
		host="${host%%:*}"
	fi
	printf '%s' "$host"
}

fleet_agent_public_url() {
	local host
	host="$(fleet_agent_api_host)"
	if [[ -n "$host" ]]; then
		printf 'https://%s' "$host"
		return 0
	fi
	if [[ -n "${FLEET_HTTPS_PUBLIC_URL:-}" ]]; then
		printf '%s' "${FLEET_HTTPS_PUBLIC_URL%/}"
		return 0
	fi
	if [[ -n "${FLEET_CENTRAL_URL:-}" ]]; then
		printf '%s' "${FLEET_CENTRAL_URL%/}"
		return 0
	fi
	echo "https://YOUR_CONTROLLER"
}

fleet_agent_http_api_base() {
	local host api_port
	host="$(fleet_agent_api_host)"
	api_port="${API_PORT:-4000}"
	if [[ -n "$host" ]]; then
		printf 'http://%s:%s/api/public' "$host" "$api_port"
		return 0
	fi
	echo "http://YOUR_CONTROLLER:4000/api/public"
}

fleet_agent_fix_bootstrap_url() {
	printf '%s/fix-agent-connection.sh' "$(fleet_agent_http_api_base)"
}

fleet_agent_fix_url() {
	fleet_agent_fix_bootstrap_url
}

fleet_agent_install_k_bootstrap_url() {
	printf '%s/agent-install-k.sh' "$(fleet_agent_http_api_base)"
}

fleet_agent_install_k_url() {
	fleet_agent_install_k_bootstrap_url
}

fleet_agent_default_ca_path() {
	printf '%s' "${FLEET_CA_FILE:-${HOME}/.fleet/ca.crt}"
}

fleet_agent_coerce_https_central() {
	local url="${1%/}"
	case "$url" in
	https://*) printf '%s' "$url" ;;
	http://*)
		if [[ "${FLEET_REQUIRE_TLS_BOOTSTRAP:-0}" == "1" || "${FLEET_REQUIRE_TLS:-0}" == "1" ]]; then
			local host="${url#http://}"
			host="${host%%/*}"
			host="${host%%:*}"
			printf 'https://%s' "$host"
		else
			printf '%s' "$url"
		fi
		;;
	*) printf '%s' "$url" ;;
	esac
}

fleet_agent_enable_linger_if_root() {
	if [[ "$(id -u)" -eq 0 ]] && command -v loginctl >/dev/null 2>&1; then
		loginctl enable-linger root 2>/dev/null || true
	fi
}

fleet_agent_stop_strays() {
	if command -v systemctl >/dev/null 2>&1; then
		systemctl stop fleet-agent.service 2>/dev/null || true
		systemctl --user stop fleet-agent.service 2>/dev/null || true
	fi
	if pgrep -x fleet-agent >/dev/null 2>&1; then
		pkill -x fleet-agent 2>/dev/null || true
		sleep 1
	fi
}

fleet_agent_write_runtime_config() {
	local central
	central="$(fleet_agent_coerce_https_central "${1:-}")"
	export FLEET_CENTRAL_URL="$central"

	if declare -F fleet_prepare_tls >/dev/null 2>&1; then
		fleet_prepare_tls "$central" || return 1
	fi

	local cfg="${HOME}/.config/fleet-agent/env"
	local dat="${HOME}/.local/share/fleet-agent"
	local ca_file
	ca_file="$(fleet_agent_default_ca_path)"
	if [[ -n "${FLEET_CA_FILE:-}" && -f "${FLEET_CA_FILE}" ]]; then
		ca_file="$FLEET_CA_FILE"
	fi

	mkdir -p "$(dirname "$cfg")" "$(dirname "$ca_file")" "$dat"

	{
		cat <<EOF
# Written by fleet-agent install/autoconnect — do not put pairing secrets here.
FLEET_CENTRAL_URL=${central}
FLEET_CA_FILE=${ca_file}
PATH=${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin
EOF
		if [[ -n "${FLEET_TLS_PIN:-}" ]]; then
			printf 'FLEET_TLS_PIN=%s\n' "$FLEET_TLS_PIN"
		fi
		if [[ -n "${FLEET_TLS_MIN_VERSION:-}" ]]; then
			printf 'FLEET_TLS_MIN_VERSION=%s\n' "$FLEET_TLS_MIN_VERSION"
		fi
	} >"$cfg"
	chmod 0600 "$cfg"

	cat >"$dat/run.sh" <<EOS
#!/usr/bin/env bash
set -euo pipefail
if [[ -f "\$HOME/.config/fleet-agent/env" ]]; then
	set -a
	# shellcheck disable=SC1090
	source "\$HOME/.config/fleet-agent/env"
	set +a
fi
exec "\$HOME/.local/bin/fleet-agent"
EOS
	chmod 0755 "$dat/run.sh"
	return 0
}

fleet_agent_install_system_unit() {
	local home_dir="${1:-$HOME}"
	local env_file="${home_dir}/.config/fleet-agent/env"
	local run_script="${home_dir}/.local/share/fleet-agent/run.sh"

	if [[ ! -x "$run_script" ]]; then
		echo "missing $run_script" >&2
		return 1
	fi

	systemctl --user stop fleet-agent.service 2>/dev/null || true
	systemctl --user disable fleet-agent.service 2>/dev/null || true

	cat >/etc/systemd/system/fleet-agent.service <<UNIT
[Unit]
Description=Fleet Patch Control Agent
Documentation=https://github.com/jacksonm36/fleet-controll
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
EnvironmentFile=-${env_file}
ExecStart=${run_script}
Restart=always
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
UNIT

	systemctl daemon-reload
	systemctl enable fleet-agent.service
}

fleet_agent_install_user_unit() {
	local home_dir="${1:-$HOME}"
	mkdir -p "${home_dir}/.config/systemd/user"
	cat >"${home_dir}/.config/systemd/user/fleet-agent.service" <<UNIT
[Unit]
Description=Fleet Patch Control Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=-%h/.config/fleet-agent/env
ExecStart=%h/.local/share/fleet-agent/run.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
	systemctl --user daemon-reload
	systemctl --user enable fleet-agent.service
	fleet_agent_enable_linger_if_root
}

fleet_agent_service_active() {
	if [[ "$(id -u)" -eq 0 ]] && systemctl is-active fleet-agent.service >/dev/null 2>&1; then
		return 0
	fi
	systemctl --user is-active fleet-agent.service >/dev/null 2>&1
}

fleet_agent_restart_service() {
	if ! command -v systemctl >/dev/null 2>&1; then
		return 1
	fi

	fleet_agent_stop_strays

	if [[ "$(id -u)" -eq 0 ]] && [[ "${FLEET_FORCE_USER_SYSTEMD:-0}" != "1" ]]; then
		if [[ ! -f /etc/systemd/system/fleet-agent.service ]]; then
			fleet_agent_install_system_unit "$HOME" || return 1
		fi
		systemctl restart fleet-agent.service 2>/dev/null \
			|| systemctl start fleet-agent.service 2>/dev/null \
			|| return 1
		return 0
	fi

	if [[ ! -f "${HOME}/.config/systemd/user/fleet-agent.service" ]]; then
		fleet_agent_install_user_unit "$HOME" || return 1
	fi
	systemctl --user restart fleet-agent.service 2>/dev/null \
		|| systemctl --user start fleet-agent.service 2>/dev/null \
		|| return 1
	fleet_agent_enable_linger_if_root
}

fleet_agent_verify_connection() {
	local central="${1%/}"
	local token_file="${FLEET_AGENT_TOKEN_FILE:-$HOME/.fleet-agent.token}"
	local token wait_i

	[[ -s "$token_file" ]] || return 1
	token="$(tr -d ' \r\n' <"$token_file")"
	[[ -n "$token" ]] || return 1

	if declare -F fleet_curl_tls_args >/dev/null 2>&1; then
		fleet_curl_tls_args
	else
		FLEET_CURL_TLS_ARGS=()
	fi

	for wait_i in $(seq 1 24); do
		if curl -fsS "${FLEET_CURL_TLS_ARGS[@]}" \
			-X POST "${central}/api/agent/v1/heartbeat" \
			-H "Authorization: Bearer ${token}" \
			-H "Content-Type: application/json" \
			-d '{"version":"fleet-install-verify"}' >/dev/null 2>&1; then
			return 0
		fi
		if ! fleet_agent_service_active; then
			fleet_agent_restart_service 2>/dev/null || true
		fi
		sleep 2
	done
	return 1
}

# Idempotent: TLS CA, env, systemd, restart, heartbeat verify.
fleet_agent_ensure_connected() {
	local central="${1:-}"
	[[ -n "$central" ]] || central="${FLEET_CENTRAL_URL:-}"
	central="$(fleet_agent_coerce_https_central "$central")"

	if [[ ! -x "${HOME}/.local/bin/fleet-agent" ]] && ! command -v fleet-agent >/dev/null 2>&1; then
		echo "fleet-agent binary not found" >&2
		return 1
	fi
	if [[ ! -s "${FLEET_AGENT_TOKEN_FILE:-$HOME/.fleet-agent.token}" ]]; then
		echo "missing ~/.fleet-agent.token — enroll first" >&2
		return 1
	fi

	echo "--- auto-connect: TLS + systemd + verify"
	fleet_agent_write_runtime_config "$central" || return 1

	if [[ "$(id -u)" -eq 0 ]] && [[ "${FLEET_FORCE_USER_SYSTEMD:-0}" != "1" ]]; then
		fleet_agent_install_system_unit "$HOME" || return 1
	else
		fleet_agent_install_user_unit "$HOME" || return 1
	fi

	if [[ "${FLEET_DEFER_AGENT_RESTART:-0}" == "1" ]]; then
		echo "TLS/systemd config applied (agent restart deferred)."
		return 0
	fi

	fleet_agent_restart_service || return 1

	if fleet_agent_verify_connection "$central"; then
		echo "Agent online (heartbeat OK)."
		return 0
	fi

	echo "Retrying agent start…" >&2
	fleet_agent_restart_service || true
	sleep 3
	if fleet_agent_verify_connection "$central"; then
		echo "Agent online (heartbeat OK)."
		return 0
	fi

	echo "Agent failed to reach controller after install." >&2
	fleet_agent_journal_hint >&2
	return 1
}

fleet_agent_journal_hint() {
	if [[ "$(id -u)" -eq 0 ]]; then
		echo "  journalctl -u fleet-agent -n 40 --no-pager"
	else
		echo "  journalctl --user -u fleet-agent -n 40 --no-pager"
	fi
}
