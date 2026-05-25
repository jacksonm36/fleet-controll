#!/usr/bin/env bash
# Persist FLEET_CENTRAL_URL and enable fleet-agent on WSL startup (systemd user, else cron @reboot).
#
# Prerequisites: ~/.local/bin/fleet-agent exists and ~/.fleet-agent.token populated (already enrolled).
#
# Usage (inside WSL as normal user):
#   export FLEET_CENTRAL_URL=http://127.0.0.1:4000
#   bash scripts/wsl-fleet-agent-autostart.sh
#
# Optional: FORCE_CRON=1 to skip systemd and install cron-only.
#
set -euo pipefail

CENTRAL="$(printf '%s' "${FLEET_CENTRAL_URL:-}" | sed -e 's,/\+$,,')"
if [[ -z "$CENTRAL" ]]; then
	echo >&2 "set FLEET_CENTRAL_URL before running."
	exit 1
fi

AGENT_BIN="$HOME/.local/bin/fleet-agent"
if [[ ! -x "$AGENT_BIN" ]]; then
	echo >&2 "missing $AGENT_BIN — run rust-agent-setup-wsl.sh first."
	exit 1
fi

CFG="$HOME/.config/fleet-agent"
DAT="$HOME/.local/share/fleet-agent"
mkdir -p "$CFG" "$DAT"

cat >"$CFG/env" <<EOF
# Written by wsl-fleet-agent-autostart.sh — do not put one-time pairing secrets here.
FLEET_CENTRAL_URL=$CENTRAL
PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
EOF
chmod 0600 "$CFG/env"

cat >"$DAT/run.sh" <<EOS
#!/usr/bin/env bash
set -euo pipefail
if [[ -f "\$HOME/.config/fleet-agent/env" ]]; then
	set -a
	# shellcheck disable=SC1090
	source "\$HOME/.config/fleet-agent/env"
	set +a
fi
if [[ -n "\${INVOCATION_ID:-}" ]]; then
	exec "\$HOME/.local/bin/fleet-agent"
fi
mkdir -p "\$HOME/.local/share/fleet-agent"
exec "\$HOME/.local/bin/fleet-agent" >>"\$HOME/.local/share/fleet-agent/agent.log" 2>&1
EOS
chmod 0755 "$DAT/run.sh"

use_systemd=0
if [[ "${FORCE_CRON:-0}" != "1" ]] && command -v systemctl >/dev/null 2>&1; then
	state="$(systemctl is-system-running 2>/dev/null || true)"
	if [[ "$state" == running || "$state" == degraded ]]; then
		use_systemd=1
	fi
fi

if [[ "$use_systemd" -eq 1 ]]; then
	systemctl --user stop fleet-agent.service 2>/dev/null || true
	mkdir -p "$HOME/.config/systemd/user"
	cat >"$HOME/.config/systemd/user/fleet-agent.service" <<UNIT
[Unit]
Description=Fleet rust agent (WSL user)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=-%h/.config/fleet-agent/env
ExecStart=%h/.local/share/fleet-agent/run.sh
Restart=on-failure
RestartSec=15

[Install]
WantedBy=default.target
UNIT
	systemctl --user daemon-reload
	systemctl --user enable fleet-agent.service
	systemctl --user restart fleet-agent.service || true
	echo "fleet-agent systemd --user enabled. If user services don't start until you log in interactively:"
	echo "    sudo loginctl enable-linger $USER"
	exit 0
fi

cron_boot="$DAT/cron-bootstrap.sh"
cat >"$cron_boot" <<'BOOT'
#!/usr/bin/env bash
nohup "$HOME/.local/share/fleet-agent/run.sh" >/dev/null 2>&1 &
BOOT
chmod 0755 "$cron_boot"

hook='fleet-wsl-agent-cron-bootstrap'
cron_line="@reboot sleep 60 \"$cron_boot\" # $hook"

if ! command -v crontab >/dev/null 2>&1; then
	echo >&2 "No systemd and no crontab. Install cron: sudo apt-get install -y cron"
	exit 1
fi

tmp="$(mktemp)"
(
	(crontab -l 2>/dev/null || true) | grep -Fv "$hook" || true
	printf '%s\n' "$cron_line"
) >"$tmp"
crontab "$tmp"
rm -f "$tmp"

if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
	sudo DEBIAN_FRONTEND=noninteractive service cron restart 2>/dev/null \
		|| sudo systemctl restart cron 2>/dev/null \
		|| true
fi

echo "Installed cron @reboot fleet-agent via $DAT/run.sh"
echo "Ensure cron is running inside WSL: sudo apt-get install -y cron && sudo service cron start"
