#!/usr/bin/env bash
# Build the Go fleet-agent (full inventory: dpkg, snap, docker, systemd, …) and install to ~/.local/bin.
#
# Environment:
#   FLEET_REPO           repo root (default: parent of scripts/)
#   INSTALL_PREFIX       install dir (default: ~/.local/bin)
#   SKIP_SYSTEM_DEPS     set to 1 to skip apt install of golang-go

set -euo pipefail

ROOT="${FLEET_REPO:-}"
if [[ -z "$ROOT" ]]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

AGENT_DIR="$ROOT/agent"
PREFIX="${INSTALL_PREFIX:-$HOME/.local/bin}"

if [[ ! -f "$AGENT_DIR/go.mod" ]]; then
  echo "Go agent sources not found at $AGENT_DIR (set FLEET_REPO?)" >&2
  exit 1
fi

mkdir -p "$PREFIX"

need_go() {
  command -v go >/dev/null 2>&1
}

run_apt() {
  if [[ "$(id -u)" -eq 0 ]]; then
    DEBIAN_FRONTEND=noninteractive apt-get "$@"
    return
  fi
  if command -v sudo >/dev/null 2>&1; then
    sudo DEBIAN_FRONTEND=noninteractive apt-get "$@"
    return
  fi
  echo "Need root or sudo to install golang-go." >&2
  exit 1
}

install_go_toolchain() {
  [[ "$(uname -s)" == "Linux" ]] || return 0
  if [[ "${SKIP_SYSTEM_DEPS:-0}" == "1" ]]; then
    return 0
  fi
  if need_go; then
    return 0
  fi
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Install Go 1.22+ manually (https://go.dev/dl/) then re-run with SKIP_SYSTEM_DEPS=1." >&2
    exit 1
  fi
  echo "--- installing golang-go (apt) ---"
  run_apt update -y
  run_apt install -y golang-go
}

install_go_toolchain

if ! need_go; then
  echo "go not found on PATH after install attempt" >&2
  exit 1
fi

echo "--- Go agent build (full inventory) ---"
echo "    go version: $(go version)"
cd "$AGENT_DIR"
export CGO_ENABLED=0
go build -trimpath -ldflags="-s -w" -o "$PREFIX/fleet-agent" ./cmd/agent
chmod 0755 "$PREFIX/fleet-agent"
echo "--- installed: $PREFIX/fleet-agent (Go — docker, snap, systemd, dpkg/rpm) ---"
echo "Ensure PATH contains: $PREFIX"
