# Observability (InfluxDB + Loki + Grafana — native install)

Fleet agents push **host metrics every 30 seconds** to the Fleet API (`POST /api/agent/v1/metrics`).
The API stores the latest snapshot on each agent row and forwards time-series data to **InfluxDB** for Grafana dashboards.

**Logs** from `fleet-api`, `fleet-web`, and `fleet-agent` systemd units are shipped to **Loki** via **Promtail** (native systemd services).

> **Docker:** The observability stack is installed with **apt + systemd** (no Docker Compose). Docker on managed hosts is supported only for **container inventory and monitoring** (images, running containers, compose projects) via the agent — not for running InfluxDB/Grafana/Loki.

## Quick start (controller host)

```bash
sudo bash scripts/install-fleet-observability.sh
sudo systemctl restart fleet-api.service
# Rebuild agent on enrolled hosts:
cd agent && go build -o bin/fleet-agent-linux-amd64 ./cmd/agent
```

Open Grafana at **http://127.0.0.1:3002** (port 3002 — Fleet web/nginx use loopback **3001**, nginx public redirect uses **3000**):

- User: `admin`
- Password: `fleet-grafana-secret` (override with `GRAFANA_ADMIN_PASSWORD`)

Dashboard: **Fleet → Fleet Host Metrics** (auto-provisioned).

### Native services

| Service | systemd unit | Port |
|---------|--------------|------|
| InfluxDB 2 | `influxdb` | 8086 |
| Loki | `loki` | 3100 |
| Promtail | `promtail` | 9080 (internal) |
| Grafana | `grafana-server` | 3002 (default; not 3001 — that is Fleet web behind nginx) |

```bash
sudo systemctl status influxdb loki promtail grafana-server
journalctl -u promtail -u loki -f
```

## Metrics collected (Linux agents)

| Metric | Source |
|--------|--------|
| CPU % | `/proc/stat` |
| Memory % | `/proc/meminfo` |
| Network RX/TX (bytes/sec) | `/proc/net/dev` |
| Load average | `/proc/loadavg` |
| Root disk usage % | `statfs(/)` |
| Logged-in users | `who` |
| Health score | Composite 0–100 (`healthy` / `degraded` / `critical`) |

## Docker / Podman on agents (monitoring only)

The Go agent inventories Docker and Podman workloads (containers, images, services) using the host CLI — see `agent/cmd/agent/inventory_apps.go`. Fleet **does not** install `docker.io` via apt (that can break existing Docker CE / Desktop stacks). Use whatever `docker` or `podman` is already on the host.

Optional CVE tooling (debsecan only, opt-in):

```bash
FLEET_INSTALL_SCANNER_DEPS=1 bash scripts/install-fleet-agent-scanners.sh
```

## Environment variables (controller `.env`)

```env
INFLUX_URL=http://127.0.0.1:8086
INFLUX_TOKEN=fleet-influx-dev-token-change-in-production
INFLUX_ORG=fleet
INFLUX_BUCKET=host_metrics
LOKI_URL=http://127.0.0.1:3100
GRAFANA_PUBLIC_URL=http://127.0.0.1:3002
NEXT_PUBLIC_GRAFANA_URL=http://127.0.0.1:3002
```

Change `INFLUX_TOKEN` and Grafana admin password in production.

## Fleet UI

- **Monitoring** sidebar page — live host metrics, fleet aggregates, per-host cards (refreshes every 10s)
- Link to Grafana for historical charts and Loki log exploration

## Promtail / journal

Promtail runs as a native service and reads the host journal (`/run/log/journal`). Ensure `promtail` can read journals (Debian package typically runs as root or adds the user to `systemd-journal`).

## Architecture

```
Agent (30s) ──HTTPS──► Fleet API ──► PostgreSQL (latest snapshot)
                              └──► InfluxDB ──► Grafana (native)
systemd journal ──► Promtail ──► Loki ──► Grafana (native)

Agent ──docker/podman CLI──► container inventory ──► Fleet API (Postgres)
```
