package main

import (
	"fmt"
	"log"
	"os/exec"
	"runtime"
	"strings"
)

// ensureAnsible installs ansible (and ansible-playbook) if absent from PATH.
// Idempotent: returns nil immediately if already installed.
func ensureAnsible(sudo bool) error {
	if _, err := exec.LookPath("ansible"); err == nil {
		return nil
	}
	log.Printf("bootstrap: ansible not found, installing…")
	if err := installAnsible(sudo); err != nil {
		return err
	}
	log.Printf("bootstrap: ansible installed")
	return nil
}

// ensureTerraform installs terraform if absent from PATH.
// Idempotent: returns nil immediately if already installed.
func ensureTerraform(sudo bool) error {
	if _, err := exec.LookPath("terraform"); err == nil {
		return nil
	}
	log.Printf("bootstrap: terraform not found, installing…")
	if err := installTerraform(sudo); err != nil {
		return err
	}
	log.Printf("bootstrap: terraform installed")
	return nil
}

// bootstrapRun runs one command, logs output lines via log.Printf, returns any error.
func bootstrapRun(sudo bool, name string, args ...string) error {
	cmd := execCommand(sudo, name, args) // sets DEBIAN_FRONTEND=noninteractive etc.
	out, err := cmd.CombinedOutput()
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if t := strings.TrimSpace(line); t != "" {
			log.Printf("bootstrap: %s", t)
		}
	}
	return err
}

func installAnsible(sudo bool) error {
	switch runtime.GOOS {
	case "linux":
		return installAnsibleLinux(sudo)
	case "darwin":
		return installViaBrew(sudo, "ansible")
	default:
		return fmt.Errorf("ansible auto-install not supported on %s", runtime.GOOS)
	}
}

func installAnsibleLinux(sudo bool) error {
	switch detectLinuxPatchManager() {
	case "apt":
		if err := bootstrapRun(sudo, "apt-get", "update", "-qq"); err != nil {
			log.Printf("bootstrap: apt-get update warning: %v", err)
		}
		return bootstrapRun(sudo, "apt-get", "install", "-y", "-q", "ansible")
	case "dnf":
		return bootstrapRun(sudo, "dnf", "install", "-y", "-q", "ansible")
	case "yum":
		// EPEL required for RHEL 7/8 before ansible is available
		_ = bootstrapRun(sudo, "yum", "install", "-y", "-q", "epel-release")
		return bootstrapRun(sudo, "yum", "install", "-y", "-q", "ansible")
	case "pacman":
		return bootstrapRun(sudo, "pacman", "-S", "--noconfirm", "--needed", "ansible")
	case "apk":
		return bootstrapRun(sudo, "apk", "add", "--no-cache", "ansible")
	case "zypper":
		return bootstrapRun(sudo, "zypper", "--non-interactive", "install", "ansible")
	default:
		// Universal fallback: pip3
		if _, err := exec.LookPath("pip3"); err == nil {
			return bootstrapRun(false, "pip3", "install", "--quiet", "--user", "ansible")
		}
		return fmt.Errorf("no supported package manager for ansible install")
	}
}

func installTerraform(sudo bool) error {
	switch runtime.GOOS {
	case "linux":
		return installTerraformLinux(sudo)
	case "darwin":
		_ = bootstrapRun(false, "brew", "tap", "hashicorp/tap")
		return installViaBrew(sudo, "hashicorp/tap/terraform")
	default:
		return fmt.Errorf("terraform auto-install not supported on %s", runtime.GOOS)
	}
}

func installTerraformLinux(sudo bool) error {
	switch detectLinuxPatchManager() {
	case "apt":
		return installTerraformApt(sudo)
	case "dnf", "yum":
		return installTerraformRPM(sudo)
	case "pacman":
		// terraform is in the Arch community/extra repo
		return bootstrapRun(sudo, "pacman", "-S", "--noconfirm", "--needed", "terraform")
	case "apk":
		// Terraform is in Alpine community repo
		return bootstrapRun(sudo, "apk", "add", "--no-cache", "--repository=https://dl-cdn.alpinelinux.org/alpine/edge/community", "terraform")
	case "zypper":
		return installTerraformRPM(sudo)
	default:
		return fmt.Errorf("no supported package manager for terraform install")
	}
}

// installTerraformApt adds the official HashiCorp apt repository and installs terraform.
func installTerraformApt(sudo bool) error {
	// Prerequisites
	if err := bootstrapRun(sudo, "apt-get", "install", "-y", "-q", "gnupg", "software-properties-common", "curl"); err != nil {
		log.Printf("bootstrap: terraform prereq warning: %v", err)
	}

	// Import HashiCorp GPG key
	gpgKey := "/usr/share/keyrings/hashicorp-archive-keyring.gpg"
	importCmd := fmt.Sprintf(
		"curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --batch --yes --dearmor -o %s",
		gpgKey,
	)
	if err := bootstrapRun(sudo, "sh", "-c", importCmd); err != nil {
		return fmt.Errorf("import hashicorp gpg key: %w", err)
	}

	// Detect distro codename for the repo URL
	codename := distroCodename()
	repoLine := fmt.Sprintf(
		"deb [signed-by=%s] https://apt.releases.hashicorp.com %s main",
		gpgKey, codename,
	)
	addRepo := fmt.Sprintf("echo '%s' > /etc/apt/sources.list.d/hashicorp.list", repoLine)
	if err := bootstrapRun(sudo, "sh", "-c", addRepo); err != nil {
		return fmt.Errorf("add hashicorp apt repo: %w", err)
	}

	if err := bootstrapRun(sudo, "apt-get", "update", "-qq"); err != nil {
		return fmt.Errorf("apt-get update after hashicorp repo: %w", err)
	}
	return bootstrapRun(sudo, "apt-get", "install", "-y", "-q", "terraform")
}

// installTerraformRPM adds the HashiCorp RPM repo and installs terraform.
func installTerraformRPM(sudo bool) error {
	repoURL := "https://rpm.releases.hashicorp.com/RHEL/hashicorp.repo"
	// Try dnf config-manager, fall back to yum-config-manager
	addCmd := fmt.Sprintf(
		"dnf config-manager --add-repo %s 2>/dev/null || yum-config-manager --add-repo %s 2>/dev/null",
		repoURL, repoURL,
	)
	if err := bootstrapRun(sudo, "sh", "-c", addCmd); err != nil {
		return fmt.Errorf("add hashicorp rpm repo: %w", err)
	}
	manager := "dnf"
	if _, err := exec.LookPath("dnf"); err != nil {
		manager = "yum"
	}
	return bootstrapRun(sudo, manager, "install", "-y", "-q", "terraform")
}

func installViaBrew(_ bool, pkg string) error {
	if _, err := exec.LookPath("brew"); err != nil {
		return fmt.Errorf("brew not found; install %s manually", pkg)
	}
	return bootstrapRun(false, "brew", "install", pkg)
}

// distroCodename returns the OS release codename (e.g. "jammy", "bookworm").
// Falls back to "jammy" (Ubuntu 22.04 LTS) if detection fails.
func distroCodename() string {
	if lsb, err := exec.LookPath("lsb_release"); err == nil {
		if out, err := exec.Command(lsb, "-cs").Output(); err == nil {
			if cs := strings.TrimSpace(string(out)); cs != "" {
				return cs
			}
		}
	}
	// Parse /etc/os-release VERSION_CODENAME
	if out, err := exec.Command("sh", "-c", `. /etc/os-release 2>/dev/null && echo "$VERSION_CODENAME"`).Output(); err == nil {
		if cs := strings.TrimSpace(string(out)); cs != "" {
			return cs
		}
	}
	return "jammy"
}
