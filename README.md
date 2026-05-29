# Fleet Patch Control

Central patch / agent management (API, web UI, Rust `fleet-agent`).

Repo: [github.com/jacksonm36/fleet-controll](https://github.com/jacksonm36/fleet-controll)

## Inspired by PatchMon

Patch planning (dry-run preview → approve → execute), security-only upgrades, and patch history
are inspired by [PatchMon](https://github.com/PatchMon/PatchMon). This repository is an
independent implementation (MIT); see [docs/INSPIRATION.md](docs/INSPIRATION.md) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Patch workflow (operators)

1. Open an agent → **Preview updates** (dry-run job).
2. Review the plan (packages, security badges) → select packages if needed.
3. **Approve & patch** to queue a real upgrade job with live logs.
4. Fleet **Patches** page shows run history.

**Encrypted agent traffic:** use HTTPS/WSS — see [docs/SECURITY-TLS.md](docs/SECURITY-TLS.md) and `scripts/setup-fleet-tls.sh`.

## Quick install (curl from GitHub)

### Central controller (WSL / Linux)

Postgres + Node stack + seed admin:

```bash
curl -fsSL https://raw.githubusercontent.com/jacksonm36/fleet-controll/main/scripts/install-fleet-controller.sh | bash
```

Start dev servers after install:

```bash
FLEET_START_DEV=1 curl -fsSL https://raw.githubusercontent.com/jacksonm36/fleet-controll/main/scripts/install-fleet-controller.sh | bash
```

### Agent (Linux / WSL)

Mint a pairing secret in the UI (**Enrollment**), then:

```bash
curl -fsSL https://raw.githubusercontent.com/jacksonm36/fleet-controll/main/scripts/install-fleet-agent.sh \
  | FLEET_ENROLL_TOKEN='your-minted-secret' bash
```

Or curl the install script from your running API (auto-detects controller URL):

```bash
curl -fsSL 'http://YOUR_CONTROLLER:4000/api/public/agent-install.sh' \
  | FLEET_ENROLL_TOKEN='your-minted-secret' bash
```

## Docs

- [docs/INSPIRATION.md](docs/INSPIRATION.md) — PatchMon attribution and adopted concepts
- [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md) — Grafana, Loki, InfluxDB host metrics
- [docs/AGENT-INSTALL.md](docs/AGENT-INSTALL.md) — agent discovery, GitHub releases, env vars
- [rust-agent/README.md](rust-agent/README.md) — binary details

## Systemd (production-style, boots on login)

After bootstrap, install units as root (runs API + Web as your install user, starts on boot):

```bash
sudo bash scripts/install-fleet-systemd.sh
```

Manage:

```bash
sudo systemctl status fleet-api fleet-web
sudo systemctl restart fleet-controller.target
journalctl -u fleet-api -u fleet-web -f
```

Manual / dev start (uses systemd if installed, else background processes):

```bash
export SKIP_BOOTSTRAP_ENV=1 FLEET_LAN_IP=$(hostname -I | awk '{print $1}')
bash scripts/start-controller-lan.sh
```

## Local development

```bash
bash scripts/bootstrap-wsl.sh   # first time
npm run dev                     # API :4000, web :3000
```
