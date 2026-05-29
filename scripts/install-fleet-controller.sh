#!/usr/bin/env bash
# Install Fleet central (API + web + Postgres) on Linux / WSL.
#
#   curl -fsSL https://raw.githubusercontent.com/jacksonm36/fleet-controll/main/scripts/install-fleet-controller.sh | bash
#
# Environment:
#   FLEET_GITHUB_REPO     git clone URL (default: jacksonm36/fleet-controll)
#   FLEET_GITHUB_REF      branch (default: main)
#   FLEET_INSTALL_DIR     clone target (default: $HOME/fleet-controll)
#   SKIP_BOOTSTRAP_ENV    1 = keep existing .env in install dir
#   FLEET_START_DEV       1 = start npm run dev in background after bootstrap
#   FLEET_SKIP_ROOT_APT   1 = skip postgres apt (already installed)

set -euo pipefail

GITHUB_REPO="${FLEET_GITHUB_REPO:-https://github.com/jacksonm36/fleet-controll.git}"
GITHUB_REF="${FLEET_GITHUB_REF:-main}"
INSTALL_DIR="${FLEET_INSTALL_DIR:-$HOME/fleet-controll}"

strip_crlf() {
	local f
	for f in "$@"; do
		[[ -f "$f" ]] && sed -i 's/\r$//' "$f" 2>/dev/null || true
	done
}

clone_or_update() {
	if [[ -d "$INSTALL_DIR/.git" ]]; then
		echo "--- updating $INSTALL_DIR"
		git -C "$INSTALL_DIR" fetch --depth 1 origin "$GITHUB_REF"
		git -C "$INSTALL_DIR" checkout -B "$GITHUB_REF" "origin/$GITHUB_REF" 2>/dev/null || git -C "$INSTALL_DIR" pull --ff-only
	else
		echo "--- cloning $GITHUB_REPO → $INSTALL_DIR"
		git clone --depth 1 --branch "$GITHUB_REF" "$GITHUB_REPO" "$INSTALL_DIR"
	fi
}

run_root_prereqs() {
	if [[ "${FLEET_SKIP_ROOT_APT:-0}" == "1" ]]; then
		return 0
	fi
	if [[ "$(id -u)" -eq 0 ]]; then
		bash "$INSTALL_DIR/scripts/wsl-install-prereqs.sh"
		return 0
	fi
	if command -v sudo >/dev/null 2>&1; then
		echo "--- Postgres + curl (sudo; may prompt for password)"
		sudo bash "$INSTALL_DIR/scripts/wsl-install-prereqs.sh"
		return 0
	fi
	echo "Run as root once, then re-run this script:" >&2
	echo "  bash $INSTALL_DIR/scripts/wsl-install-prereqs.sh" >&2
	exit 1
}

main() {
	command -v git >/dev/null 2>&1 || {
		echo "git is required to clone the controller repo." >&2
		exit 1
	}

	clone_or_update
	cd "$INSTALL_DIR"
	strip_crlf scripts/wsl-install-prereqs.sh scripts/bootstrap-wsl.sh scripts/dev-wsl.sh

	run_root_prereqs

	export SKIP_BOOTSTRAP_ENV="${SKIP_BOOTSTRAP_ENV:-0}"
	bash scripts/bootstrap-wsl.sh

	echo ""
	echo "Controller ready under: $INSTALL_DIR"
	echo "  API:  http://127.0.0.1:4000/health"
	echo "  Web:  http://127.0.0.1:3000"
	echo "  Login credentials: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in $INSTALL_DIR/.env"

	if [[ "${FLEET_START_DEV:-0}" == "1" ]]; then
		strip_crlf scripts/dev-wsl.sh
		setsid -f bash scripts/dev-wsl.sh >> /tmp/fleet-dev.log 2>&1 || true
		echo "Dev stack starting (log: /tmp/fleet-dev.log)"
	fi

	echo ""
	echo "Systemd (boot on startup):  sudo bash $INSTALL_DIR/scripts/install-fleet-systemd.sh"
	echo "Start manually:            cd $INSTALL_DIR && npm run dev"
	echo "Agent install:             curl -fsSL http://127.0.0.1:4000/api/public/agent-install.sh | FLEET_ENROLL_TOKEN='…' bash"
}

main "$@"
