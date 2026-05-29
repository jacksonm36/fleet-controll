#!/usr/bin/env bash
# Replace fleet-agent with the controller's prebuilt binary (keeps enrollment token).
# Run on each enrolled host:
#   curl -kfsSL 'https://YOUR_CONTROLLER/api/public/upgrade-fleet-agent-binary.sh' | bash
set -euo pipefail

FLEET_CENTRAL_DEFAULT="${FLEET_CENTRAL_DEFAULT:-}"
FLEET_PUBLIC_BASE="${FLEET_PUBLIC_BASE:-}"
FLEET_CA_DOWNLOAD_URL="${FLEET_CA_DOWNLOAD_URL:-}"

# __FLEET_TLS_HELPER_EMBED__

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

stop_fleet_agent() {
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl stop fleet-agent.service 2>/dev/null; then
      echo "Stopped system fleet-agent.service"
      return 0
    fi
    if systemctl --user stop fleet-agent.service 2>/dev/null; then
      echo "Stopped user fleet-agent.service"
      return 0
    fi
  fi
  if pgrep -x fleet-agent >/dev/null 2>&1; then
    pkill -x fleet-agent || true
    sleep 1
    echo "Stopped running fleet-agent process"
  fi
}

start_fleet_agent() {
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl restart fleet-agent.service 2>/dev/null; then
      echo "Restarted system fleet-agent.service"
      return 0
    fi
    if systemctl --user restart fleet-agent.service 2>/dev/null; then
      echo "Restarted user fleet-agent.service"
      return 0
    fi
  fi
  echo "Start the agent manually if it does not auto-start." >&2
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

  local arch asset
  arch="$(uname -m)"
  case "$arch" in
  x86_64 | amd64) asset="fleet-agent-linux-amd64" ;;
  aarch64 | arm64) asset="fleet-agent-linux-arm64" ;;
  *) echo "Unsupported arch: $arch" >&2; exit 1 ;;
  esac

  local base="${FLEET_PUBLIC_BASE:-}"
  if [[ -z "$base" ]]; then
    base="$(resolve_central)/api/public"
  fi
  local url="${base%/}/${asset}"

  if declare -F fleet_prepare_tls >/dev/null 2>&1; then
    fleet_prepare_tls "$(resolve_central)"
  fi
  fleet_curl_tls_args 2>/dev/null || FLEET_CURL_TLS_ARGS=()

  echo "=== Upgrade Fleet agent (metrics + patch plan support) ==="
  stop_fleet_agent
  echo "Downloading: $url"
  install_fleet_agent_binary "$url" "$prefix/fleet-agent"

  if strings "$prefix/fleet-agent" 2>/dev/null | grep -q pushMetrics; then
    echo "Binary includes metrics collector."
  else
    echo "Warning: binary may be too old (no metrics). Rebuild on controller: cd agent && go build -o bin/$asset ./cmd/agent" >&2
  fi

  start_fleet_agent
  echo "Done. Metrics should appear on the controller Monitoring page within ~30s."
}

main "$@"
