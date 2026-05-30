#!/usr/bin/env bash
# Install fleet-agent on Linux (incl. WSL), discover controller, enroll, optional autostart.
#
# Quick start (after minting a pairing secret in Fleet UI → Enrollment):
#
#   curl -fsSL https://raw.githubusercontent.com/jacksonm36/fleet-controll/main/scripts/install-fleet-agent.sh \
#     | FLEET_ENROLL_TOKEN='paste-secret-here' bash
#
# Or fetch from your running controller (auto-sets central URL to that host):
#
#   curl -fsSL http://YOUR_CONTROLLER:4000/api/public/agent-install.sh \
#     | FLEET_ENROLL_TOKEN='paste-secret-here' bash
#
# Environment:
#   FLEET_ENROLL_TOKEN      required one-time pairing secret
#   FLEET_CENTRAL_URL       optional; discovered if unset
#   FLEET_GITHUB_RAW_BASE   optional; raw.githubusercontent.com prefix for helper scripts
#   FLEET_USE_RELEASE       set to 1 to download prebuilt binary from GitHub Releases
#   FLEET_AGENT_FLAVOR      go (default) or rust — go agent has full inventory (docker, snap, systemd)
#   FLEET_SKIP_AUTOSTART    set to 1 to skip systemd/cron setup
#   FLEET_SKIP_ENROLL       set to 1 if already enrolled (~/.fleet-agent.token exists)
#   SKIP_SYSTEM_DEPS        skip apt toolchain install for source builds
#   FLEET_SKIP_SCANNER_DEPS set to 1 to skip all optional apt scanner installs (default)
#   FLEET_INSTALL_SCANNER_DEPS set to 1 to opt in to debsecan (never installs docker.io)
#   FLEET_INSTALL_ANSIBLE   set to 1 to opt in to apt install ansible (playbook jobs)
#   FLEET_INSTALL_TRIVY     set to 1 to install trivy + FLEET_TRIVY_SCAN=1 (slow)
#   FLEET_INSTALL_CROWDSEC  set to 1 to install crowdsec/cscli when in apt
#   FLEET_SKIP_ANSIBLE      set to 1 to skip ansible even when scanner deps enabled

set -euo pipefail

# curl | bash leaves BASH_SOURCE unset under bash -u
if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
	SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
	REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
	SCRIPT_DIR=""
	REPO_ROOT=""
fi

# Injected when served from Fleet API (see apps/api agent-install route)
FLEET_CENTRAL_DEFAULT="${FLEET_CENTRAL_DEFAULT:-}"
FLEET_HTTPS_PUBLIC_URL="${FLEET_HTTPS_PUBLIC_URL:-}"
FLEET_REQUIRE_TLS_BOOTSTRAP="${FLEET_REQUIRE_TLS_BOOTSTRAP:-0}"
FLEET_DISCOVER_HOST="${FLEET_DISCOVER_HOST:-}"
# When set, download Go agent sources from controller instead of cloning GitHub
FLEET_AGENT_SOURCE_URL="${FLEET_AGENT_SOURCE_URL:-}"
# Prebuilt Go binary from controller (preferred — no golang on target required)
FLEET_AGENT_BINARY_URL="${FLEET_AGENT_BINARY_URL:-}"
FLEET_CA_DOWNLOAD_URL="${FLEET_CA_DOWNLOAD_URL:-}"
FLEET_TLS_PIN_AUTO="${FLEET_TLS_PIN_AUTO:-1}"
FLEET_TLS_MIN_VERSION="${FLEET_TLS_MIN_VERSION:-}"
FLEET_INSTALLER_BUILD="${FLEET_INSTALLER_BUILD:-}"

# __FLEET_TLS_HELPER_EMBED__
# __FLEET_SCANNERS_EMBED__
# __FLEET_SYSTEMD_EMBED__

fleet_source_systemd_helpers() {
	if declare -F fleet_agent_restart_service >/dev/null 2>&1; then
		return 0
	fi
	local helper=""
	if [[ -n "${SCRIPT_DIR:-}" && -f "${SCRIPT_DIR}/fleet-agent-systemd.sh" ]]; then
		helper="${SCRIPT_DIR}/fleet-agent-systemd.sh"
	elif [[ -f "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)/fleet-agent-systemd.sh" ]]; then
		helper="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/fleet-agent-systemd.sh"
	fi
	if [[ -n "$helper" && -f "$helper" ]]; then
		# shellcheck disable=SC1090
		source "$helper"
	fi
}

GITHUB_RAW="${FLEET_GITHUB_RAW_BASE:-https://raw.githubusercontent.com/jacksonm36/fleet-controll/main}"
GITHUB_RELEASE="${FLEET_GITHUB_RELEASE_BASE:-https://github.com/jacksonm36/fleet-controll/releases/latest/download}"

strip_crlf() {
	local f
	for f in "$@"; do
		[[ -f "$f" ]] && sed -i 's/\r$//' "$f" 2>/dev/null || true
	done
}

fetch_helper() {
	local name="$1"
	local dest="$2"
	if [[ -n "${SCRIPT_DIR:-}" && -f "${SCRIPT_DIR}/${name}" ]]; then
		cp "${SCRIPT_DIR}/${name}" "$dest"
		strip_crlf "$dest"
		return 0
	fi
	local api_host
	api_host="$(fleet_agent_api_host 2>/dev/null || true)"
	if [[ -z "$api_host" && -n "${FLEET_DISCOVER_HOST:-}" ]]; then
		api_host="${FLEET_DISCOVER_HOST}"
	fi
	if [[ -n "$api_host" ]] && command -v curl >/dev/null 2>&1; then
		if curl -fsSL "http://${api_host}:4000/api/public/${name}" -o "$dest" 2>/dev/null; then
			strip_crlf "$dest"
			chmod +x "$dest"
			return 0
		fi
	fi
	if [[ -n "${FLEET_AGENT_BINARY_URL:-}" ]] && command -v curl >/dev/null 2>&1; then
		fleet_curl_tls_args 2>/dev/null || FLEET_CURL_TLS_ARGS=()
		if curl -fsSL "${FLEET_CURL_TLS_ARGS[@]}" "${FLEET_AGENT_BINARY_URL}/${name}" -o "$dest" 2>/dev/null; then
			strip_crlf "$dest"
			chmod +x "$dest"
			return 0
		fi
	fi
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL "${GITHUB_RAW}/scripts/${name}" -o "$dest"
	elif command -v wget >/dev/null 2>&1; then
		wget -qO "$dest" "${GITHUB_RAW}/scripts/${name}"
	else
		echo "Need curl or wget to download helper scripts." >&2
		exit 1
	fi
	strip_crlf "$dest"
	chmod +x "$dest"
}

need_cmd() {
	command -v "$1" >/dev/null 2>&1 || {
		echo "Missing required command: $1" >&2
		exit 1
	}
}

resolve_central() {
	if [[ -n "${FLEET_CENTRAL_URL:-}" ]]; then
		printf '%s' "${FLEET_CENTRAL_URL%/}"
		return 0
	fi
	if [[ -n "${FLEET_HTTPS_PUBLIC_URL:-}" ]]; then
		export FLEET_CENTRAL_URL="${FLEET_HTTPS_PUBLIC_URL%/}"
		printf '%s' "${FLEET_CENTRAL_URL}"
		return 0
	fi
	if [[ -n "$FLEET_CENTRAL_DEFAULT" ]]; then
		export FLEET_CENTRAL_URL="$FLEET_CENTRAL_DEFAULT"
		printf '%s' "${FLEET_CENTRAL_DEFAULT%/}"
		return 0
	fi
	local discover="$REPO_ROOT/scripts/fleet-discover-central.sh"
	if [[ ! -f "$discover" ]]; then
		discover="$(mktemp)"
		fetch_helper "fleet-discover-central.sh" "$discover"
	fi
	strip_crlf "$discover"
	FLEET_DISCOVER_HOST="${FLEET_DISCOVER_HOST:-}" bash "$discover"
}

fleet_coerce_https_central() {
	local url="${1%/}"
	case "$url" in
	https://*) printf '%s' "$url" ;;
	http://*)
		if [[ "${FLEET_REQUIRE_TLS_BOOTSTRAP:-0}" == "1" ]]; then
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

install_go_agent_from_repo() {
	local repo="$1"
	strip_crlf "$repo/scripts/go-agent-setup-linux.sh" 2>/dev/null || true
	FLEET_REPO="$repo" SKIP_SYSTEM_DEPS="${SKIP_SYSTEM_DEPS:-0}" \
		bash "$repo/scripts/go-agent-setup-linux.sh"
}

install_rust_agent_from_repo() {
	local repo="$1"
	strip_crlf "$repo/scripts/rust-agent-setup-wsl.sh" 2>/dev/null || true
	FLEET_REPO="$repo" SKIP_SYSTEM_DEPS="${SKIP_SYSTEM_DEPS:-0}" \
		bash "$repo/scripts/rust-agent-setup-wsl.sh"
}

install_agent_binary() {
	local prefix="${INSTALL_PREFIX:-$HOME/.local/bin}"
	mkdir -p "$prefix"
	local flavor="${FLEET_AGENT_FLAVOR:-go}"

	fleet_curl_tls_args 2>/dev/null || FLEET_CURL_TLS_ARGS=()
	if [[ -n "${FLEET_AGENT_BINARY_URL:-}" && "$flavor" != "rust" ]]; then
		need_cmd curl
		local arch asset tmp
		arch="$(uname -m)"
		case "$arch" in
		x86_64 | amd64) asset="fleet-agent-linux-amd64" ;;
		aarch64 | arm64) asset="fleet-agent-linux-arm64" ;;
		*)
			echo "No prebuilt agent for arch=$arch; building from source." >&2
			asset=""
			;;
		esac
		if [[ -n "$asset" ]]; then
			tmp="$(mktemp)"
			local bin_url="${FLEET_AGENT_BINARY_URL}/${asset}"
			echo "--- downloading prebuilt Go agent: $bin_url ---"
			if curl -fSL "${FLEET_CURL_TLS_ARGS[@]}" "$bin_url" -o "$tmp"; then
				install -m 0755 "$tmp" "$prefix/fleet-agent"
				rm -f "$tmp"
				echo "Installed $prefix/fleet-agent (prebuilt Go from controller)"
				return 0
			fi
			echo "Prebuilt download failed ($bin_url); trying source build…" >&2
		fi
	fi

	if [[ "${FLEET_USE_RELEASE:-0}" == "1" ]]; then
		need_cmd curl
		local arch asset tmp
		arch="$(uname -m)"
		case "$arch" in
		x86_64 | amd64) asset="fleet-agent-linux-amd64" ;;
		aarch64 | arm64) asset="fleet-agent-linux-arm64" ;;
		*)
			echo "No release binary for arch=$arch; unset FLEET_USE_RELEASE to compile from source." >&2
			exit 1
			;;
		esac
		tmp="$(mktemp)"
		echo "--- downloading ${GITHUB_RELEASE}/${asset}"
		curl -fsSL "${GITHUB_RELEASE}/${asset}" -o "$tmp"
		install -m 0755 "$tmp" "$prefix/fleet-agent"
		rm -f "$tmp"
		echo "Installed $prefix/fleet-agent (release)"
		return 0
	fi

	if [[ -n "${FLEET_AGENT_SOURCE_URL:-}" && "$flavor" != "rust" ]]; then
		echo "--- downloading Go agent source from controller ---"
		need_cmd curl
		need_cmd tar
		local src_dir
		src_dir="$(mktemp -d)"
		curl -fsSL "$FLEET_AGENT_SOURCE_URL" | tar -xzf - -C "$src_dir"
		install_go_agent_from_repo "$src_dir"
		return 0
	fi

	if [[ -n "$REPO_ROOT" && -f "$REPO_ROOT/agent/go.mod" && "$flavor" != "rust" ]]; then
		install_go_agent_from_repo "$REPO_ROOT"
		return 0
	fi

	if [[ -n "$REPO_ROOT" && -d "$REPO_ROOT/rust-agent" && "$flavor" == "rust" ]]; then
		install_rust_agent_from_repo "$REPO_ROOT"
		return 0
	fi

	echo "--- cloning fleet-controll for agent build (flavor=$flavor) ---"
	need_cmd git
	local clone_dir repo_url
	clone_dir="$(mktemp -d)"
	repo_url="https://github.com/jacksonm36/fleet-controll.git"
	if [[ "$GITHUB_RAW" =~ https://raw\.githubusercontent\.com/([^/]+)/([^/]+)/ ]]; then
		repo_url="https://github.com/${BASH_REMATCH[1]}/${BASH_REMATCH[2]}.git"
	fi
	git clone --depth 1 "$repo_url" "$clone_dir"
	if [[ "$flavor" == "rust" ]]; then
		install_rust_agent_from_repo "$clone_dir"
	else
		if [[ -f "$clone_dir/agent/go.mod" ]]; then
			install_go_agent_from_repo "$clone_dir"
		else
			echo "Go agent not in cloned repo; falling back to rust-agent (limited inventory)." >&2
			install_rust_agent_from_repo "$clone_dir"
		fi
	fi
}

fleet_source_tls_helpers() {
	if declare -F fleet_prepare_tls >/dev/null 2>&1; then
		return 0
	fi
	local helper="$SCRIPT_DIR/fleet-ensure-tls-ca.sh"
	if [[ -z "$SCRIPT_DIR" || ! -f "$helper" ]]; then
		helper="$(mktemp)"
		if [[ -n "${FLEET_CA_DOWNLOAD_URL:-}" ]]; then
			# Served install scripts embed the helper; GitHub fallback for raw clones.
			fetch_helper "fleet-ensure-tls-ca.sh" "$helper"
		else
			echo >&2 "TLS helper missing — use controller install URL (https://…/api/public/agent-install.sh)"
			return 1
		fi
	fi
	# shellcheck disable=SC1090
	source "$helper"
}

fleet_ensure_scanners() {
	if declare -F fleet_install_scanners >/dev/null 2>&1; then
		return 0
	fi
	local helper="${SCRIPT_DIR}/install-fleet-agent-scanners.sh"
	if [[ -n "$SCRIPT_DIR" && -f "$helper" ]]; then
		# shellcheck disable=SC1090
		source "$helper"
		return 0
	fi
	helper="$(mktemp)"
	fetch_helper "install-fleet-agent-scanners.sh" "$helper"
	# shellcheck disable=SC1090
	source "$helper"
}

enroll_agent() {
	local central="$1"
	fleet_source_tls_helpers
	fleet_prepare_tls "$central"
	local enroll_sh
	enroll_sh="$(mktemp)"
	fleet_curl_tls_args
	echo "--- fetching enroll script from controller"
	if ! curl -fSL "${FLEET_CURL_TLS_ARGS[@]}" "${central}/api/public/agent-enroll.sh" -o "$enroll_sh"; then
		if [[ -f "$REPO_ROOT/scripts/fleet-agent-curl-enroll.sh" ]]; then
			cp "$REPO_ROOT/scripts/fleet-agent-curl-enroll.sh" "$enroll_sh"
		else
			fetch_helper "fleet-agent-curl-enroll.sh" "$enroll_sh"
		fi
	fi
	strip_crlf "$enroll_sh"
	if [[ -z "${FLEET_ENROLL_TOKEN:-}" ]]; then
		echo "FLEET_ENROLL_TOKEN is required (mint in Fleet UI → Enrollment)." >&2
		exit 1
	fi
	export FLEET_CENTRAL_URL="$central"
	if ! bash "$enroll_sh" "$FLEET_ENROLL_TOKEN"; then
		echo "" >&2
		echo "Enrollment failed." >&2
		echo "  • HTTP 409: this VM may already be in Fleet — use FLEET_HOSTNAME=<Agents table name> with a fresh token," >&2
		echo "      or delete the stale row and enroll again (token is not burned on 409)." >&2
		echo "  • HTTP 400 invalid_body: hostname invalid or os-release too large — retry after controller update, or:" >&2
		echo "      HOSTNAME_OVERRIDE=mail-host FLEET_ENROLL_TOKEN='…' bash  (fresh token)" >&2
		echo "  • HTTP 400 invalid_or_expired_token: mint a NEW token in Fleet → Enrollment (single-use)." >&2
		echo "  • Copy the secret exactly — no quotes, spaces, or placeholder text." >&2
		echo "  • HTTP 403 tls_required: use HTTP bootstrap (no -k on first curl):" >&2
		echo "      curl -fsSL 'https://${FLEET_DISCOVER_HOST:-YOUR_CONTROLLER}/api/public/agent-install-k.sh' | FLEET_ENROLL_TOKEN='…' bash" >&2
		echo "  • Or: curl -kfsSL '${central}/api/public/agent-install.sh' | FLEET_ENROLL_TOKEN='…' bash" >&2
		rm -f "$enroll_sh"
		exit 1
	fi
	rm -f "$enroll_sh"
}

setup_autostart() {
	local central="$1"
	fleet_source_tls_helpers 2>/dev/null || true
	fleet_source_systemd_helpers
	fleet_agent_ensure_connected "$central"
}

main() {
	need_cmd bash
	if [[ "${FLEET_ENROLL_TOKEN:-}" == *"paste"* ]] || [[ "${FLEET_ENROLL_TOKEN:-}" == *"PASTE"* ]] \
		|| [[ "${FLEET_ENROLL_TOKEN:-}" == *"<"* ]] || [[ "${FLEET_ENROLL_TOKEN:-}" == *"HERE"* ]]; then
		echo "Replace FLEET_ENROLL_TOKEN with the real secret from Fleet → Enrollment (not a placeholder)." >&2
		exit 1
	fi

	echo "=== Fleet agent install (${FLEET_INSTALLER_BUILD:-legacy}) ==="
	CENTRAL="$(fleet_coerce_https_central "$(resolve_central)")"
	export FLEET_CENTRAL_URL="$CENTRAL"
	echo "Controller: $CENTRAL"

	fleet_source_tls_helpers
	fleet_prepare_tls "$CENTRAL"

	install_agent_binary

	fleet_ensure_scanners
	# Safe default: no apt changes unless FLEET_INSTALL_SCANNER_DEPS=1 (never installs docker).
	if [[ "${FLEET_SKIP_SCANNER_DEPS:-1}" == "1" && "${FLEET_INSTALL_SCANNER_DEPS:-0}" != "1" ]]; then
		if declare -F _fleet_report_container_cli >/dev/null 2>&1; then
			echo "--- container inventory (existing host tools only) ---"
			_fleet_report_container_cli
		fi
		echo "Optional apt scanner packages skipped (safe install)."
		echo "  CVE debsecan:  FLEET_INSTALL_SCANNER_DEPS=1"
		echo "  Ansible jobs:  FLEET_INSTALL_SCANNER_DEPS=1 FLEET_INSTALL_ANSIBLE=1"
	else
		fleet_install_scanners || echo "Scanner deps skipped or failed (non-fatal)." >&2
	fi

	if [[ "${FLEET_SKIP_ENROLL:-0}" == "1" ]]; then
		echo "Skipping enroll (FLEET_SKIP_ENROLL=1)."
	elif [[ -n "${FLEET_ENROLL_TOKEN:-}" ]]; then
		if [[ -s "$HOME/.fleet-agent.token" ]]; then
			echo "Replacing existing enrollment with new token…"
			rm -f "$HOME/.fleet-agent.token"
		fi
		enroll_agent "$CENTRAL"
	elif [[ -s "$HOME/.fleet-agent.token" ]]; then
		echo "Already enrolled (~/.fleet-agent.token). Pass FLEET_ENROLL_TOKEN to re-enroll, or FLEET_SKIP_ENROLL=1 to silence."
	else
		echo "No ~/.fleet-agent.token — mint a token in Fleet → Enrollment and pass FLEET_ENROLL_TOKEN." >&2
	fi

	if [[ "${FLEET_SKIP_AUTOSTART:-0}" != "1" ]]; then
		if ! setup_autostart "$CENTRAL"; then
			echo "Agent install finished but auto-connect failed." >&2
			exit 1
		fi
	fi

	echo ""
	echo "Done — agent enrolled and online."
	echo "  Binary:  $HOME/.local/bin/fleet-agent"
	echo "  Token:   $HOME/.fleet-agent.token"
	if [[ -n "${FLEET_CA_FILE:-}" && -f "${FLEET_CA_FILE}" ]]; then
		echo "  CA:      $FLEET_CA_FILE"
	fi
	if [[ -n "${FLEET_TLS_PIN:-}" ]]; then
		echo "  TLS pin: SHA-512 SPKI (FLEET_TLS_PIN)"
	fi
	if [[ "$(id -u)" -eq 0 ]]; then
		echo "  Service: systemctl status fleet-agent"
	else
		echo "  Service: systemctl --user status fleet-agent"
	fi
	echo ""
	echo "In Fleet UI: queue inventory refresh on this host for packages/CVEs."
}

main "$@"
