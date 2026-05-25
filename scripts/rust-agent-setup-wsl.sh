#!/usr/bin/env bash
# Install rustup (if missing), build fleet-agent release, install to ~/.local/bin.
# Intended for Debian/Ubuntu-based WSL. Linux/macOS-compatible (not Windows exe).
#
# Environment:
#   FLEET_REPO           repo root unix path (default: parent of scripts/)
#   INSTALL_PREFIX       where to copy fleet-agent (default: ~/.local/bin)
#   SKIP_SYSTEM_DEPS     set to 1 to skip sudo apt toolchain install
#
set -euo pipefail

ROOT="${FLEET_REPO:-}"
if [[ -z "$ROOT" ]]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

CRATE="$ROOT/rust-agent"
PREFIX="${INSTALL_PREFIX:-$HOME/.local/bin}"

if [[ ! -d "$CRATE" ]]; then
  echo >&2 "rust-agent crate not found at $CRATE (set FLEET_REPO?)"
  exit 1
fi

mkdir -p "$PREFIX"

needs_cc() {
  command -v cc >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1
}

install_linux_build_deps() {
  [[ "$(uname -s)" == "Linux" ]] || return 0
  if [[ "${SKIP_SYSTEM_DEPS:-0}" == "1" ]]; then
    return 0
  fi
  if needs_cc; then return 0; fi
  if ! command -v sudo >/dev/null 2>&1; then
    echo >&2 "Need a C toolchain. Install gcc/build-essential, then re-run (or SKIP_SYSTEM_DEPS=1 if already installed)."
    exit 1
  fi
  if ! sudo -n true >/dev/null 2>&1; then
    echo >&2 "--- no passwordless sudo: install toolchain manually ---"
    echo >&2 "  sudo DEBIAN_FRONTEND=noninteractive apt-get update -y \\"
    echo >&2 "    && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential pkg-config curl ca-certificates"
    echo >&2 "Then: SKIP_SYSTEM_DEPS=1 FLEET_REPO=... bash scripts/rust-agent-setup-wsl.sh"
    exit 1
  fi
  echo "--- installing build toolchain (sudo apt-get; passwordless sudo) ---"
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential pkg-config curl ca-certificates
}

ensure_rustup() {
  if command -v cargo >/dev/null 2>&1; then
    echo "rustc/cargo OK: $(command -v cargo)"
    return 0
  fi
  echo "--- installing rustup (user toolchain) ---"
  if ! command -v curl >/dev/null 2>&1; then
    echo >&2 "curl missing. Ubuntu/Debian: sudo apt-get install -y curl ca-certificates"
    exit 1
  fi
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --no-modify-path
  # shellcheck disable=SC1091
  if [[ -s "$HOME/.cargo/env" ]]; then
    . "$HOME/.cargo/env"
  fi
  export PATH="${HOME}/.cargo/bin:${PATH:-}"
}

echo "--- Fleet rust-agent setup (Linux) ---"
install_linux_build_deps
ensure_rustup
export PATH="${HOME}/.cargo/bin:${PATH:-}"

cd "$CRATE"

if ! needs_cc; then
  echo >&2 "No C compiler after setup; cargo will fail linking."
  exit 1
fi

echo "--- cargo build --release ---"
cargo build --release

cp "$CRATE/target/release/fleet-agent" "$PREFIX/fleet-agent"
chmod 0755 "$PREFIX/fleet-agent"
echo "--- installed: $PREFIX/fleet-agent"
echo "Ensure PATH contains: $PREFIX"
echo "Suggested API URL for WSL agents (Fleet on Windows host): $(bash "$(dirname "${BASH_SOURCE[0]}")/fleet-central-url-wsl.sh")"
