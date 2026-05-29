#!/usr/bin/env bash
# Minimal install: prebuilt Go fleet-agent (full inventory). No golang required.
set -euo pipefail

FLEET_CENTRAL_DEFAULT="${FLEET_CENTRAL_DEFAULT:-}"
FLEET_PUBLIC_BASE="${FLEET_PUBLIC_BASE:-}"
FLEET_CA_DOWNLOAD_URL="${FLEET_CA_DOWNLOAD_URL:-}"
FLEET_DISCOVER_HOST="${FLEET_DISCOVER_HOST:-}"
FLEET_HTTPS_PUBLIC_URL="${FLEET_HTTPS_PUBLIC_URL:-}"
FLEET_REQUIRE_TLS_BOOTSTRAP="${FLEET_REQUIRE_TLS_BOOTSTRAP:-0}"

# __FLEET_TLS_HELPER_EMBED__
# __FLEET_SYSTEMD_EMBED__

resolve_central() {
  if [[ -n "${FLEET_CENTRAL_URL:-}" ]]; then
    printf '%s' "${FLEET_CENTRAL_URL%/}"
    return
  fi
  if [[ -n "$FLEET_CENTRAL_DEFAULT" ]]; then
    printf '%s' "${FLEET_CENTRAL_DEFAULT%/}"
    return
  fi
  echo "FLEET_CENTRAL_URL not set" >&2
  exit 1
}

install_fleet_agent_binary() {
  local url="$1"
  local dest="$2"
  local tmp
  tmp="$(mktemp "${dest}.XXXXXX")"
  curl -fSL "${FLEET_CURL_TLS_ARGS[@]}" "$url" -o "$tmp"
  chmod 0755 "$tmp"
  install -m 0755 "$tmp" "$dest"
  rm -f "$tmp"
  echo "Installed: $dest"
}

main() {
  command -v curl >/dev/null 2>&1 || { echo "curl required" >&2; exit 1; }
  local prefix="${INSTALL_PREFIX:-$HOME/.local/bin}"
  mkdir -p "$prefix"

  local arch asset central
  arch="$(uname -m)"
  case "$arch" in
  x86_64 | amd64) asset="fleet-agent-linux-amd64" ;;
  aarch64 | arm64) asset="fleet-agent-linux-arm64" ;;
  *) echo "Unsupported arch: $arch" >&2; exit 1 ;;
  esac

  central="$(resolve_central)"
  export FLEET_CENTRAL_URL="$central"

  local base="${FLEET_PUBLIC_BASE:-}"
  if [[ -z "$base" ]]; then
    base="${central}/api/public"
  fi

  echo "=== Fleet Go agent (prebuilt) ==="
  fleet_prepare_tls "$central"
  fleet_curl_tls_args

  if declare -F fleet_agent_stop_strays >/dev/null 2>&1; then
    fleet_agent_stop_strays
  fi

  echo "Downloading: ${base%/}/${asset}"
  install_fleet_agent_binary "${base%/}/${asset}" "$prefix/fleet-agent"

  if [[ ! -s "$HOME/.fleet-agent.token" ]]; then
    echo "No ~/.fleet-agent.token — enroll first (install with FLEET_ENROLL_TOKEN)." >&2
    exit 1
  fi

  fleet_agent_ensure_connected "$central"
  echo "Done — agent online."
}

main "$@"
