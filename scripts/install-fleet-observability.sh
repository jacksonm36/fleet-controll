#!/usr/bin/env bash
# Native install: InfluxDB 2 + Loki + Promtail + Grafana (apt/systemd — no Docker).
# Docker on managed hosts is inventory/monitoring only (see agent inventory_apps.go).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OBS="$ROOT/deploy/observability"
ENV_FILE="$ROOT/.env"

INFLUX_TOKEN="${INFLUX_TOKEN:-fleet-influx-dev-token-change-in-production}"
INFLUX_ADMIN_PASSWORD="${INFLUX_ADMIN_PASSWORD:-change-me-influx}"
GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-change-me-grafana}"
GRAFANA_PORT="${GRAFANA_PORT:-3002}"
WEB_PORT="${WEB_PORT:-3001}"
if [[ "$GRAFANA_PORT" == "$WEB_PORT" ]]; then
  echo "GRAFANA_PORT ($GRAFANA_PORT) must differ from Fleet web WEB_PORT ($WEB_PORT)" >&2
  exit 1
fi
GRAFANA_PUBLIC_URL="${GRAFANA_PUBLIC_URL:-http://127.0.0.1:${GRAFANA_PORT}}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/install-fleet-observability.sh" >&2
  exit 1
fi

append_env() {
  local key="$1"
  local val="$2"
  if [[ -f "$ENV_FILE" ]] && grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    return
  fi
  echo "${key}=${val}" >>"$ENV_FILE"
  echo "Added ${key} to $ENV_FILE"
}

install_repos() {
  apt-get update -qq
  apt-get install -y -qq curl gnupg ca-certificates wget apt-transport-https

  if [[ ! -f /etc/apt/sources.list.d/influxdata.list ]]; then
    curl -fsSL https://repos.influxdata.com/influxdata-archive.key \
      | gpg --dearmor -o /etc/apt/trusted.gpg.d/influxdata-archive.gpg
    echo "deb [signed-by=/etc/apt/trusted.gpg.d/influxdata-archive.gpg] https://repos.influxdata.com/debian stable main" \
      >/etc/apt/sources.list.d/influxdata.list
  fi

  if [[ ! -f /etc/apt/sources.list.d/grafana.list ]]; then
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://apt.grafana.com/gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/grafana.gpg
    echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" \
      >/etc/apt/sources.list.d/grafana.list
  fi

  apt-get update -qq
}

install_packages() {
  apt-get install -y -qq influxdb2 grafana loki promtail
}

setup_influx() {
  systemctl enable influxdb
  systemctl restart influxdb
  sleep 2

  if influx ping --host http://127.0.0.1:8086 >/dev/null 2>&1; then
    if ! influx org list --host http://127.0.0.1:8086 --token "$INFLUX_TOKEN" >/dev/null 2>&1; then
      echo "Initializing InfluxDB org/bucket…"
      influx setup \
        --host http://127.0.0.1:8086 \
        --username fleet \
        --password "$INFLUX_ADMIN_PASSWORD" \
        --org fleet \
        --bucket host_metrics \
        --retention 720h \
        --token "$INFLUX_TOKEN" \
        --force
    else
      echo "InfluxDB already configured."
    fi
  else
    echo "Warning: InfluxDB not responding on :8086 yet." >&2
  fi
}

install_configs() {
  install -d -m 0755 /var/lib/loki/chunks /var/lib/loki/rules /var/lib/loki/compactor
  chown -R loki:nogroup /var/lib/loki
  install -d -m 0755 /var/lib/promtail
  if id promtail >/dev/null 2>&1; then
    chown promtail:nogroup /var/lib/promtail
    usermod -aG systemd-journal promtail 2>/dev/null || true
  fi
  install -m 0644 "$OBS/loki-config.yml" /etc/loki/config.yml
  install -m 0644 "$OBS/promtail-config.yml" /etc/promtail/config.yml

  install -d -m 0755 /etc/grafana/provisioning/datasources
  install -d -m 0755 /etc/grafana/provisioning/dashboards
  sed "s|\${INFLUX_TOKEN}|${INFLUX_TOKEN}|g" \
    "$OBS/grafana/provisioning/datasources/datasources.yml" \
    >/etc/grafana/provisioning/datasources/datasources.yml
  install -m 0644 "$OBS/grafana/provisioning/dashboards/dashboards.yml" \
    /etc/grafana/provisioning/dashboards/dashboards.yml
  install -m 0644 "$OBS/grafana/provisioning/dashboards/fleet-host-metrics.json" \
    /etc/grafana/provisioning/dashboards/fleet-host-metrics.json

  # Avoid port clash with Fleet web UI on :3000
  if grep -q '^;http_port' /etc/grafana/grafana.ini 2>/dev/null; then
    sed -i "s/^;http_port = 3000/http_port = ${GRAFANA_PORT}/" /etc/grafana/grafana.ini
  elif grep -q '^http_port' /etc/grafana/grafana.ini 2>/dev/null; then
    sed -i "s/^http_port = .*/http_port = ${GRAFANA_PORT}/" /etc/grafana/grafana.ini
  else
    printf '\n[server]\nhttp_port = %s\n' "$GRAFANA_PORT" >>/etc/grafana/grafana.ini
  fi

  # Restore deb defaults if a prior run clobbered /etc/default/grafana-server
  if ! grep -q '^DATA_DIR=' /etc/default/grafana-server 2>/dev/null; then
    cat >/etc/default/grafana-server <<'GRAFANA_DEFAULT'
GRAFANA_USER=grafana
GRAFANA_GROUP=grafana
GRAFANA_HOME=/usr/share/grafana
LOG_DIR=/var/log/grafana
DATA_DIR=/var/lib/grafana
MAX_OPEN_FILES=10000
CONF_DIR=/etc/grafana
CONF_FILE=/etc/grafana/grafana.ini
RESTART_ON_UPGRADE=true
PLUGINS_DIR=/var/lib/grafana/plugins
PROVISIONING_CFG_DIR=/etc/grafana/provisioning
PID_FILE_DIR=/run/grafana
GRAFANA_DEFAULT
  fi
  grep -q '^GF_SERVER_HTTP_PORT=' /etc/default/grafana-server 2>/dev/null \
    || echo "GF_SERVER_HTTP_PORT=${GRAFANA_PORT}" >>/etc/default/grafana-server
  grep -q '^GF_SERVER_ROOT_URL=' /etc/default/grafana-server 2>/dev/null \
    || echo "GF_SERVER_ROOT_URL=${GRAFANA_PUBLIC_URL}" >>/etc/default/grafana-server
  grep -q '^INFLUX_TOKEN=' /etc/default/grafana-server 2>/dev/null \
    || echo "INFLUX_TOKEN=${INFLUX_TOKEN}" >>/etc/default/grafana-server

  install -d -m 0755 /var/lib/grafana /var/log/grafana
  chown grafana:grafana /var/lib/grafana /var/log/grafana
}

start_services() {
  systemctl enable loki promtail grafana-server
  systemctl restart loki
  systemctl restart promtail
  systemctl restart grafana-server
  sleep 2

  if command -v grafana-cli >/dev/null 2>&1; then
    grafana-cli admin reset-admin-password "$GRAFANA_ADMIN_PASSWORD" >/dev/null 2>&1 || true
  fi
}

echo "=== Fleet observability (native apt install) ==="
install_repos
install_packages
setup_influx
install_configs
start_services

chown -R "$(stat -c '%U:%G' "$ROOT" 2>/dev/null || echo 'root:root')" "$ENV_FILE" 2>/dev/null || true
append_env "INFLUX_URL" "http://127.0.0.1:8086"
append_env "INFLUX_TOKEN" "$INFLUX_TOKEN"
append_env "INFLUX_ORG" "fleet"
append_env "INFLUX_BUCKET" "host_metrics"
append_env "LOKI_URL" "http://127.0.0.1:3100"
append_env "GRAFANA_PUBLIC_URL" "$GRAFANA_PUBLIC_URL"
append_env "NEXT_PUBLIC_GRAFANA_URL" "$GRAFANA_PUBLIC_URL"

echo ""
echo "Observability stack running (systemd, no Docker):"
echo "  Grafana:  ${GRAFANA_PUBLIC_URL}  (admin / ${GRAFANA_ADMIN_PASSWORD})"
echo "  InfluxDB: http://127.0.0.1:8086"
echo "  Loki:     http://127.0.0.1:3100"
echo ""
echo "Restart Fleet API: systemctl restart fleet-api.service"
echo "Docker is NOT used for observability — agents use docker/podman CLI only for container inventory."
