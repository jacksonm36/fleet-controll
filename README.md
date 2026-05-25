# Fleet Patch Control

Central patch / agent management (API, web UI, Rust `fleet-agent`).

Repo: [github.com/jacksonm36/fleet-controll](https://github.com/jacksonm36/fleet-controll)

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

- [docs/AGENT-INSTALL.md](docs/AGENT-INSTALL.md) — agent discovery, GitHub releases, env vars
- [rust-agent/README.md](rust-agent/README.md) — binary details

## Local development

```bash
bash scripts/bootstrap-wsl.sh   # first time
npm run dev                     # API :4000, web :3000
```
