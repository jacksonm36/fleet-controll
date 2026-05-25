# Fleet central controller — install

## One command (GitHub)

On **WSL or Linux** with `git` and `sudo` for Postgres:

```bash
curl -fsSL https://raw.githubusercontent.com/jacksonm36/fleet-controll/main/scripts/install-fleet-controller.sh | bash
```

This clones [jacksonm36/fleet-controll](https://github.com/jacksonm36/fleet-controll) to `~/fleet-controll`, installs Postgres, runs `npm install`, migrates the DB, and seeds the admin user.

## Options

| Variable | Default | Purpose |
|----------|---------|---------|
| `FLEET_INSTALL_DIR` | `$HOME/fleet-controll` | Clone directory |
| `FLEET_GITHUB_REPO` | `https://github.com/jacksonm36/fleet-controll.git` | Git remote |
| `FLEET_START_DEV` | `0` | Set `1` to start `npm run dev` in background |
| `SKIP_BOOTSTRAP_ENV` | `0` | Set `1` to keep an existing `.env` |
| `FLEET_SKIP_ROOT_APT` | `0` | Set `1` if Postgres is already configured |

## After install

```bash
cd ~/fleet-controll && npm run dev
```

- Web: http://127.0.0.1:3000  
- API: http://127.0.0.1:4000  
- Credentials: `SEED_ADMIN_*` in `.env` (created by bootstrap unless skipped)

## Agents

Mint a token in **Enrollment**, then see [AGENT-INSTALL.md](AGENT-INSTALL.md).
