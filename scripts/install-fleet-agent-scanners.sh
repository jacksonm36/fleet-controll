#!/usr/bin/env bash
# Host packages for fleet-agent: CVE scanners, optional CrowdSec/trivy, Ansible jobs.
# Sourced by install-fleet-agent.sh and fix-agent-connection.sh.
#
# Environment:
#   FLEET_SKIP_SCANNER_DEPS=1   skip all package installs below (default on main installer)
#   FLEET_INSTALL_SCANNER_DEPS=1 opt in to apt installs (debsecan; never installs docker)
#   FLEET_INSTALL_ANSIBLE=1     opt in to apt install ansible (large dependency tree)
#   FLEET_SKIP_ANSIBLE=1        skip ansible even when scanner deps are enabled
#   FLEET_INSTALL_TRIVY=1       install trivy + enable FLEET_TRIVY_SCAN=1 (slow rootfs scan)
#   FLEET_INSTALL_CROWDSEC=1    install crowdsec + cscli when available in apt
#
# Never installs docker.io, podman, or other container engines — use existing host Docker.

fleet_install_scanners() {
	_fleet_report_container_cli

	if [[ "${FLEET_SKIP_SCANNER_DEPS:-0}" == "1" ]]; then
		return 0
	fi
	if [[ "${FLEET_INSTALL_SCANNER_DEPS:-0}" != "1" ]]; then
		echo "--- scanner apt installs skipped (safe default; set FLEET_INSTALL_SCANNER_DEPS=1 to install debsecan)" >&2
		return 0
	fi
	case "$(uname -s 2>/dev/null)" in
	Linux) ;;
	*) return 0 ;;
	esac

	local cfg="${HOME}/.config/fleet-agent/env"
	mkdir -p "$(dirname "$cfg")"
	touch "$cfg" 2>/dev/null || true

	if command -v apt-get >/dev/null 2>&1; then
		_fleet_apt_scanners
	elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
		_fleet_rpm_scanners
	else
		echo "--- scanner deps: no apt/dnf; install debsecan or trivy manually" >&2
	fi

	_fleet_install_ansible_deps

	_fleet_append_agent_scanner_env "$cfg"
}

_fleet_report_container_cli() {
	local found=0
	if command -v docker >/dev/null 2>&1; then
		echo "  docker CLI found: $(command -v docker) (inventory only — not installed by Fleet)"
		found=1
	fi
	if command -v podman >/dev/null 2>&1; then
		echo "  podman CLI found: $(command -v podman)"
		found=1
	fi
	if [[ "$found" -eq 0 ]]; then
		echo "  no docker/podman CLI — container inventory skipped (Fleet never installs docker.io via apt)"
	fi
}

_fleet_install_ansible_deps() {
	if [[ "${FLEET_SKIP_SCANNER_DEPS:-0}" == "1" || "${FLEET_SKIP_ANSIBLE:-0}" == "1" ]]; then
		return 0
	fi
	if [[ "${FLEET_INSTALL_ANSIBLE:-0}" != "1" ]]; then
		echo "  ansible not installed (set FLEET_INSTALL_ANSIBLE=1 if you need playbook jobs)" >&2
		return 0
	fi
	if command -v ansible-playbook >/dev/null 2>&1 && command -v ansible >/dev/null 2>&1; then
		return 0
	fi
	echo "--- installing Ansible (automation jobs) ---"
	if command -v apt-get >/dev/null 2>&1; then
		_fleet_run_apt update -qq || true
		if _fleet_run_apt install -y -qq --no-install-recommends ansible 2>/dev/null; then
			echo "  ansible installed (ansible-playbook, ansible ad-hoc)"
		else
			echo "  ansible not installed — apt install ansible or set FLEET_SKIP_ANSIBLE=1" >&2
		fi
	elif command -v dnf >/dev/null 2>&1; then
		local bin=dnf
		if [[ "$(id -u)" -eq 0 ]]; then
			$bin install -y ansible-core 2>/dev/null || $bin install -y ansible 2>/dev/null || true
		else
			sudo $bin install -y ansible-core 2>/dev/null || sudo $bin install -y ansible 2>/dev/null || true
		fi
		command -v ansible-playbook >/dev/null 2>&1 && echo "  ansible installed"
	elif command -v yum >/dev/null 2>&1; then
		if [[ "$(id -u)" -eq 0 ]]; then
			yum install -y ansible 2>/dev/null || true
		else
			sudo yum install -y ansible 2>/dev/null || true
		fi
	fi
}

_fleet_run_apt() {
	if [[ "$(id -u)" -eq 0 ]]; then
		DEBIAN_FRONTEND=noninteractive apt-get "$@"
		return
	fi
	if command -v sudo >/dev/null 2>&1; then
		sudo DEBIAN_FRONTEND=noninteractive apt-get "$@"
		return
	fi
	echo "Need root/sudo to install scanner packages (debsecan, etc.)." >&2
	return 1
}

_fleet_apt_scanners() {
	echo "--- installing CVE scanners (apt; will not install docker or upgrade unrelated packages) ---"

	# Core CVE source on Debian/Ubuntu — only touch apt when debsecan is missing.
	if command -v debsecan >/dev/null 2>&1; then
		echo "  debsecan already installed"
	else
		_fleet_run_apt update -qq || true
		if _fleet_run_apt install -y -qq --no-install-recommends debsecan 2>/dev/null; then
			echo "  debsecan installed (CVE advisories for dpkg)"
		else
			echo "  debsecan not installed (optional: apt install debsecan)" >&2
		fi
	fi

	# Never apt-install docker.io/podman — conflicts with Docker CE, Desktop, and existing stacks.

	if [[ "${FLEET_INSTALL_TRIVY:-0}" == "1" ]]; then
		if ! command -v trivy >/dev/null 2>&1; then
			_fleet_run_apt update -qq || true
		fi
		if _fleet_run_apt install -y -qq trivy 2>/dev/null; then
			echo "  trivy installed (set FLEET_TRIVY_SCAN=1 — full rootfs scan is slow)"
		else
			_fleet_install_trivy_binary || true
		fi
	fi

	if [[ "${FLEET_INSTALL_CROWDSEC:-0}" == "1" ]]; then
		if ! command -v cscli >/dev/null 2>&1; then
			_fleet_run_apt update -qq || true
		fi
		if _fleet_run_apt install -y -qq crowdsec 2>/dev/null; then
			echo "  crowdsec installed (cscli for UI CrowdSec tab)"
			_fleet_run_apt install -y -qq crowdsec-firewall-bouncer-iptables 2>/dev/null || true
		else
			echo "  crowdsec not in apt — skip or install from https://doc.crowdsec.net/" >&2
		fi
	fi
}

_fleet_install_trivy_binary() {
	command -v trivy >/dev/null 2>&1 && return 0
	local arch dest="/usr/local/bin/trivy"
	case "$(uname -m)" in
	x86_64 | amd64) arch="64bit" ;;
	aarch64 | arm64) arch="ARM64" ;;
	*) return 1 ;;
	esac
	local ver="${FLEET_TRIVY_VERSION:-0.58.0}"
	local url="https://github.com/aquasecurity/trivy/releases/download/v${ver}/trivy_${ver}_Linux-${arch}.tar.gz"
	echo "  downloading trivy v${ver}…"
	if curl -fsSL "$url" | tar -xzf - -C /tmp trivy 2>/dev/null; then
		install -m 0755 /tmp/trivy "$dest" 2>/dev/null \
			|| sudo install -m 0755 /tmp/trivy "$dest"
		rm -f /tmp/trivy
		echo "  trivy installed to $dest"
	fi
}

_fleet_rpm_scanners() {
	echo "--- installing CVE scanners (dnf/yum) ---"
	local bin="dnf"
	command -v dnf >/dev/null 2>&1 || bin="yum"
	if [[ "$(id -u)" -eq 0 ]]; then
		$bin install -y dnf-plugins-core yum-utils 2>/dev/null || true
		$bin install -y debsecan 2>/dev/null || true
	else
		sudo $bin install -y dnf-plugins-core 2>/dev/null || true
	fi
	echo "  using $bin security advisories for CVE collection"
}

_fleet_append_agent_scanner_env() {
	local cfg="$1"
	[[ -f "$cfg" ]] || return 0
	_fleet_env_ensure_kv "$cfg" FLEET_USE_SUDO true
	if [[ "${FLEET_INSTALL_TRIVY:-0}" == "1" ]] && command -v trivy >/dev/null 2>&1; then
		_fleet_env_ensure_kv "$cfg" FLEET_TRIVY_SCAN 1
	fi
}

_fleet_env_ensure_kv() {
	local file="$1" key="$2" val="$3"
	if grep -q "^${key}=" "$file" 2>/dev/null; then
		sed -i "s|^${key}=.*|${key}=${val}|" "$file"
	else
		echo "${key}=${val}" >>"$file"
	fi
}
