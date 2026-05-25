# Fleet agent — automatic install

## One command (recommended)

Mint a pairing secret in the web UI (**Enrollment**), then on the agent host (Linux / WSL):

```bash
curl -fsSL 'http://YOUR_CONTROLLER:4000/api/public/agent-install.sh' \
  | FLEET_ENROLL_TOKEN='paste-minted-secret' bash
```

The script is served by your running API. It embeds `FLEET_CENTRAL_URL` from the host you curled, then falls back to **network discovery** (`scripts/fleet-discover-central.sh`) if needed.

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
| `FLEET_SKIP_ENROLL` | `1` = skip enroll if token file exists |

## Files

- `scripts/install-fleet-agent.sh` — main installer
- `scripts/fleet-discover-central.sh` — probe `/health` on candidate URLs
- `GET /api/public/agent-install.sh` — same script with controller URL injected
