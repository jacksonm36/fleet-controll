# fleet-agent (Rust)

Single static-friendly binary that speaks the same HTTP agent API as the Go agent: **enroll**, **heartbeat**, **inventory** (stub), and **long-poll jobs**. Use it to verify the control plane without the full Go agent capabilities (package upgrades / systemd / CrowdSec are intentionally not implemented).

## Platforms

| Host | Enrollment `osType` | Default token file |
|------|-----------------------|---------------------|
| Windows (native `fleet-agent.exe`) | `windows` | `%LOCALAPPDATA%\FleetPatchControl\agent.token` |
| Linux / WSL / etc. | `linux` | `~/.fleet-agent.token` |
| macOS (`cargo` on Darwin) | `darwin` via API | `~/.fleet-agent.token` |

If you build on Windows native and hit proc-macro/AV blocks, compile inside WSL and run the Linux binary.

## Build

Needs a normal Rust toolchain (`rustup`). From this directory:

```bash
cargo build --release
```

Binary: `target/release/fleet-agent` (or `.exe` on Windows).

Under WSL (recommended if antivirus blocks Windows proc-macros):

```bash
cd /mnt/d/manager/rust-agent && cargo build --release
```

## Automatic install (Linux / WSL)

Mint a secret in the Fleet UI (**Enrollment**), then on the agent:

```bash
# Controller URL is taken from the host you curl (best)
curl -fsSL 'http://YOUR_CONTROLLER:4000/api/public/agent-install.sh' \
  | FLEET_ENROLL_TOKEN='minted-secret' bash
```

From GitHub after you push this repo (set `FLEET_GITHUB_RAW_BASE` to your `raw.githubusercontent.com/.../main` path):

```bash
curl -fsSL 'https://raw.githubusercontent.com/jacksonm36/fleet-controll/main/scripts/install-fleet-agent.sh' \
  | FLEET_ENROLL_TOKEN='minted-secret' bash
```

See [docs/AGENT-INSTALL.md](../docs/AGENT-INSTALL.md) for discovery order, release binaries, and env vars.

## Run

1. Create a **one-time pairing secret**
   - **Web UI:** log in → **Enrollment** → **Mint**.
   - **WSL only:** login + JWT mint via bash (below).
2. Set `FLEET_CENTRAL_URL` (often `http://127.0.0.1:4000`).
3. Set `FLEET_ENROLL_TOKEN` to the **exact** plaintext value (never placeholder text like `PASTE_VERBATIM_HERE` or `'<'minted secret'>'`).
4. Run `fleet-agent` once; afterward it reads `~/.fleet-agent.token` (Linux).

Mint from WSL without PowerShell (`FLEET_CENTRAL_URL` optional).
If `/mnt/` scripts were edited on Windows they may still have CRLF → strip once or use the subshell trick:

```bash
sed -i 's/\r$//' /mnt/d/manager/scripts/wsl-api-mint-enrollment-token.sh 2>/dev/null || true

export FLEET_OPERATOR_EMAIL='admin@localhost'
export FLEET_OPERATOR_PASSWORD='changeme123'   # your real Fleet login; angle brackets → 401 invalid_credentials
export FLEET_CENTRAL_URL='http://127.0.0.1:4000'
PAIR=$(bash /mnt/d/manager/scripts/wsl-api-mint-enrollment-token.sh)
export FLEET_ENROLL_TOKEN="$PAIR"
~/.local/bin/fleet-agent
```

If **`~/.local/bin/fleet-agent`** is missing, build/install inside this distro (you may be on **Debian**, not Ubuntu, where `fleet-agent` was never installed):

```bash
sed -i 's/\r$//' /mnt/d/manager/scripts/rust-agent-*.sh /mnt/d/manager/scripts/rust-agent-setup-wsl.sh 2>/dev/null || true
sudo bash /mnt/d/manager/scripts/rust-agent-apt-root.sh   # if sudo works; else Ubuntu root: `wsl -d … -u root`
SKIP_SYSTEM_DEPS=1 FLEET_REPO=/mnt/d/manager bash /mnt/d/manager/scripts/rust-agent-setup-wsl.sh
```

Use **`fleet-mint-enrollment-token.ps1` from Windows PowerShell** — not **`cd D:\`** or **`.ps1`** from bash (`D:\manager` ↔ `/mnt/d/manager`).

```bash
export FLEET_CENTRAL_URL=http://127.0.0.1:4000
export FLEET_ENROLL_TOKEN='paste-the-long-secret-from-UI-or-mint-script-exactly'
./target/release/fleet-agent
```

Next runs omit `FLEET_ENROLL_TOKEN` and read the token file (or pass `FLEET_AGENT_TOKEN`).

Secrets are **single-use**. If you enrolled once (or pasted a bogus string), **`invalid_or_expired_token`** is expected until you mint again.

### Behaviour

| Job type | Rust agent |
|----------|------------|
| `PACKAGE_REFRESH` | Pushes minimal empty inventory snapshot |
| Other | Marks job **FAILED** with an explanatory message (use Go agent for privileged work) |

## Env

| Variable | Meaning |
|---------|---------|
| `FLEET_CENTRAL_URL` | API base (no trailing slash required) |
| `FLEET_ENROLL_TOKEN` | One-time enrollment secret |
| `FLEET_AGENT_TOKEN` | API bearer after enrolment |
| `FLEET_AGENT_TOKEN_FILE` | Override token path (otherwise platform default above) |
| `SKIP_SYSTEM_DEPS` | Linux setup script: skip `sudo apt-get` (`1`), if toolchain already installed |
| `FLEET_AGENT_VERSION` | `--agent-version` default |
| `RUST_LOG` | e.g. `info` |

Flags mirror the env vars (`--central`, `--enroll-token`, etc.) via `clap`.

## Another WSL distro (test isolation)

**Automated Fleet hookup + autostart** (API reachable from Windows; JWT mint or `FleetPairingSecret`; curl enroll inside WSL; systemd user unit or cron):

```powershell
.\scripts\setup-second-wsl-fleet-agent.ps1 -WindowsRepoRoot 'D:\manager' -AutoFleetBootstrap -FleetOperatorEmail admin@localhost
# or pairing from UI/env (no JWT mint step):
.\scripts\setup-second-wsl-fleet-agent.ps1 -AutoFleetBootstrap -FleetPairingSecret '<paste>'
```

`FLEET_AUTO_WSL_BOOTSTRAP=1` is equivalent to `-AutoFleetBootstrap`. Use `-DiscoverFleetCentralFromWsl` if mirrored `localhost` fails. Scripts involved: `fleet-mint-enrollment-token.ps1`, `fleet-agent-curl-enroll.sh`, `wsl-fleet-agent-autostart.sh`.

**Primary install path** (second distro + root apt + rust build only):

```powershell
.\scripts\setup-second-wsl-fleet-agent.ps1 -WindowsRepoRoot 'D:\manager'
```

If Ubuntu (or another second distro) is **already registered** and you only want rustup/build without re-running distro install:

```powershell
.\scripts\install-rust-agent-second-wsl.ps1 -WindowsRepoRoot 'D:\manager'
```

That script auto-picks a `Ubuntu*` distro from the registry when **`-Distro`** is omitted; if there is no Ubuntu name, it uses the **second** distro listed when you have **at least two**. With only one distro registered, pass **`-Distro '…' -AllowSingleDistro`** to smoke-test — that is **not** real isolation between two installs.

**Linux build deps without the one-shot setup script**: `scripts/rust-agent-setup-wsl.sh` installs `build-essential` only when **`sudo -n`** works. Otherwise install system packages as root, then run setup with **`SKIP_SYSTEM_DEPS=1`**:

```bash
wsl -d Ubuntu-24.04 -u root -- bash /mnt/d/manager/scripts/rust-agent-apt-root.sh   # Debian/Ubuntu family
SKIP_SYSTEM_DEPS=1 FLEET_REPO=/mnt/d/manager bash /mnt/d/manager/scripts/rust-agent-setup-wsl.sh   # inside that distro as your normal user
```

Or inside the distro interactively:

```bash
sudo apt-get update && sudo apt-get install -y build-essential pkg-config curl ca-certificates
```

Then run **`rust-agent-setup-wsl.sh`** with **`SKIP_SYSTEM_DEPS=1`** (same as the two-line snippet above).

Guess `FLEET_CENTRAL_URL` from WSL toward a Fleet API **on Windows** (nameserver fallback):

```bash
bash /mnt/d/manager/scripts/fleet-central-url-wsl.sh
# often mirrored networking also works:
# export FLEET_CENTRAL_URL=http://127.0.0.1:4000
```
