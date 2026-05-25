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
#   FLEET_SKIP_AUTOSTART    set to 1 to skip systemd/cron setup
#   FLEET_SKIP_ENROLL       set to 1 if already enrolled (~/.fleet-agent.token exists)
#   SKIP_SYSTEM_DEPS        passed to rust-agent-setup-wsl.sh

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
	if [[ -f "$SCRIPT_DIR/$name" ]]; then
		cp "$SCRIPT_DIR/$name" "$dest"
		strip_crlf "$dest"
		return 0
	fi
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL "${GITHUB_RAW}/scripts/${name}" -o "$dest"
	elif command -v wget >/dev/null 2>&1; then
		wget -qO "$dest" "${GITHUB_RAW}/scripts/${name}"
	else
		echo "Need curl or wget to download helper scripts from GitHub." >&2
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
	bash "$discover"
}

install_agent_binary() {
	local prefix="${INSTALL_PREFIX:-$HOME/.local/bin}"
	mkdir -p "$prefix"

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

	if [[ -d "$REPO_ROOT/rust-agent" ]]; then
		strip_crlf "$REPO_ROOT/scripts/rust-agent-setup-wsl.sh" 2>/dev/null || true
		FLEET_REPO="$REPO_ROOT" SKIP_SYSTEM_DEPS="${SKIP_SYSTEM_DEPS:-0}" \
			bash "$REPO_ROOT/scripts/rust-agent-setup-wsl.sh"
		return 0
	fi

	echo "--- no local rust-agent/ tree; cloning minimal repo for build ---"
	need_cmd git
	local clone_dir repo_url
	clone_dir="$(mktemp -d)"
	repo_url="https://github.com/jacksonm36/fleet-controll.git"
	if [[ "$GITHUB_RAW" =~ https://raw\.githubusercontent\.com/([^/]+)/([^/]+)/ ]]; then
		repo_url="https://github.com/${BASH_REMATCH[1]}/${BASH_REMATCH[2]}.git"
	fi
	git clone --depth 1 "$repo_url" "$clone_dir"
	FLEET_REPO="$clone_dir" SKIP_SYSTEM_DEPS="${SKIP_SYSTEM_DEPS:-0}" \
		bash "$clone_dir/scripts/rust-agent-setup-wsl.sh"
}

enroll_agent() {
	local central="$1"
	local enroll_sh="$REPO_ROOT/scripts/fleet-agent-curl-enroll.sh"
	if [[ ! -f "$enroll_sh" ]]; then
		enroll_sh="$(mktemp)"
		fetch_helper "fleet-agent-curl-enroll.sh" "$enroll_sh"
	fi
	strip_crlf "$enroll_sh"
	if [[ -z "${FLEET_ENROLL_TOKEN:-}" ]]; then
		echo "FLEET_ENROLL_TOKEN is required (mint in Fleet UI → Enrollment)." >&2
		exit 1
	fi
	export FLEET_CENTRAL_URL="$central"
	bash "$enroll_sh" "$FLEET_ENROLL_TOKEN"
}

setup_autostart() {
	local central="$1"
	local auto="$REPO_ROOT/scripts/wsl-fleet-agent-autostart.sh"
	if [[ ! -f "$auto" ]]; then
		auto="$(mktemp)"
		fetch_helper "wsl-fleet-agent-autostart.sh" "$auto"
	fi
	strip_crlf "$auto"
	export FLEET_CENTRAL_URL="$central"
	bash "$auto"
}

main() {
	need_cmd bash
	if [[ "${FLEET_ENROLL_TOKEN:-}" == *"paste"* ]] || [[ "${FLEET_ENROLL_TOKEN:-}" == *"<"* ]]; then
		echo "Replace FLEET_ENROLL_TOKEN with the real secret from Enrollment (not a placeholder)." >&2
		exit 1
	fi

	echo "=== Fleet agent install ==="
	CENTRAL="$(resolve_central)"
	export FLEET_CENTRAL_URL="$CENTRAL"
	echo "Controller: $CENTRAL"

	install_agent_binary

	if [[ -s "$HOME/.fleet-agent.token" && "${FLEET_SKIP_ENROLL:-0}" == "1" ]]; then
		echo "Skipping enroll (~/.fleet-agent.token exists)."
	elif [[ -s "$HOME/.fleet-agent.token" ]]; then
		echo "Already enrolled (~/.fleet-agent.token). Skip with FLEET_SKIP_ENROLL=1 to silence."
	else
		enroll_agent "$CENTRAL"
	fi

	if [[ "${FLEET_SKIP_AUTOSTART:-0}" != "1" ]]; then
		setup_autostart "$CENTRAL" || echo "Autostart setup skipped or failed (non-fatal)." >&2
	fi

	echo ""
	echo "Done. Agent binary: $HOME/.local/bin/fleet-agent"
	echo "Token file:       $HOME/.fleet-agent.token"
	echo "Run manually:     FLEET_CENTRAL_URL=$CENTRAL $HOME/.local/bin/fleet-agent"
}

main "$@"
