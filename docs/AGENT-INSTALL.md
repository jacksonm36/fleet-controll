# Fleet agent — automatic install

## One command (recommended)

Mint a pairing secret in the web UI (**Enrollment**), then on the agent host (Linux / WSL):

```bash
curl -kfsSL 'https://YOUR_CONTROLLER/api/public/agent-install.sh' \
  | FLEET_ENROLL_TOKEN='paste-minted-secret' bash
```

Use `-k` on the first curl when the controller uses a self-signed nginx certificate (the script downloads and trusts the cert for all later HTTPS calls). Omit `-k` if you use a public CA.

## From GitHub (no running API required for download)

Push this repo to GitHub and set `NEXT_PUBLIC_FLEET_GITHUB_RAW_BASE` in `.env` / `apps/web/.env.local` to match your fork.

```bash
export FLEET_GITHUB_RAW_BASE='https://raw.githubusercontent.com/jacksonm36/fleet-controll/main'
curl -fsSL "${FLEET_GITHUB_RAW_BASE}/scripts/install-fleet-agent.sh" \
  | FLEET_ENROLL_TOKEN='paste-minted-secret' bash
```

Discovery order: explicit `FLEET_CENTRAL_URL` → `127.0.0.1:4000` → WSL Windows host (resolv.conf) → default gateway → local IPs.

## Prebuilt binary (GitHub Releases)

Tag a release (`v0.2.0`, etc.). Workflow `.github/workflows/fleet-agent-release.yml` uploads `fleet-agent-linux-amd64` / `arm64`.

```bash
export FLEET_USE_RELEASE=1
export FLEET_GITHUB_RELEASE_BASE='https://github.com/jacksonm36/fleet-controll/releases/latest/download'
curl -fsSL "${FLEET_GITHUB_RAW_BASE}/scripts/install-fleet-agent.sh" \
  | FLEET_ENROLL_TOKEN='...' bash
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `FLEET_ENROLL_TOKEN` | Required one-time secret from Enrollment |
| `FLEET_CENTRAL_URL` | Optional; auto-discovered if unset |
| `FLEET_GITHUB_RAW_BASE` | Raw GitHub URL for helper scripts |
| `FLEET_USE_RELEASE` | `1` = download release binary instead of `cargo build` |
| `FLEET_SKIP_AUTOSTART` | `1` = skip systemd/cron |
| `FLEET_CA_FILE` | Set automatically by install script when self-signed; path to controller PEM |
| `FLEET_CA_DOWNLOAD_URL` | Injected by API; install script uses this to fetch the cert |
| `FLEET_SKIP_SCANNER_DEPS` | `1` = skip optional apt installs (default on main installer) |
| `FLEET_INSTALL_SCANNER_DEPS` | `1` = opt in to `debsecan` only — **never** installs `docker.io` or podman |
| `FLEET_INSTALL_ANSIBLE` | `1` = opt in to `ansible` for playbook jobs (large dependency tree) |
| `FLEET_INSTALL_TRIVY` | `1` = install trivy and set `FLEET_TRIVY_SCAN=1` (slow rootfs scan) |
| `FLEET_INSTALL_CROWDSEC` | `1` = install `crowdsec` / `cscli` when available in apt |
| `FLEET_SKIP_ANSIBLE` | `1` = skip ansible even when scanner deps are enabled |

The default install only places the `fleet-agent` binary and enrolls — it does **not** run `apt install docker.io` or other package changes that can break existing Docker, Termix, or application stacks. Container inventory uses whatever `docker` / `podman` CLI is already on the host.

To add CVE scanning: `FLEET_INSTALL_SCANNER_DEPS=1`. For Ansible jobs: also set `FLEET_INSTALL_ANSIBLE=1`. After install, use **Queue inventory refresh** on the agent in the UI.

## Files

- `scripts/install-fleet-agent.sh` — main installer
- `scripts/install-fleet-agent-scanners.sh` — debsecan / optional trivy & CrowdSec
- `scripts/fleet-discover-central.sh` — probe `/health` on candidate URLs
- `GET /api/public/agent-install.sh` — same script with controller URL injected
