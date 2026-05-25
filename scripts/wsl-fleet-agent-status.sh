#!/usr/bin/env bash
# Print fleet-agent + rust tool status for whichever WSL distro runs this.
set -euo pipefail
echo "=== Distro ==="
grep '^PRETTY_NAME=' /etc/os-release 2>/dev/null || cat /etc/os-release 2>/dev/null | head -3
echo "user: $(whoami)  home: $HOME"
echo "=== fleet-agent ~/.local/bin/fleet-agent ==="
if [[ -x "$HOME/.local/bin/fleet-agent" ]]; then
	ls -la "$HOME/.local/bin/fleet-agent"
	"$HOME/.local/bin/fleet-agent" --help 2>&1 | head -4
else
	echo "MISSING (run rust-agent-setup-wsl.sh in THIS distro)"
fi
echo "=== cargo (PATH or ~/.cargo/bin) ==="
if command -v cargo >/dev/null 2>&1; then
	cargo --version
elif [[ -x "$HOME/.cargo/bin/cargo" ]]; then
	echo "On disk: $HOME/.cargo/bin/cargo (add to PATH: source ~/.cargo/env)"
	"$HOME/.cargo/bin/cargo" --version
else
	echo "MISSING"
fi
echo "=== enroll token file ~/.fleet-agent.token ==="
if [[ -s "$HOME/.fleet-agent.token" ]]; then
	echo "EXISTS ($(wc -c <"$HOME/.fleet-agent.token") bytes)"
else
	echo "none yet (enroll once)"
fi
echo "=== repo mount /mnt/d/manager/scripts (sample) ==="
if [[ -f /mnt/d/manager/scripts/rust-agent-setup-wsl.sh ]]; then
	echo "OK /mnt/d/manager visible"
else
	echo "MISSING /mnt/d/manager — open repo on D: or adjust drive letter"
fi
