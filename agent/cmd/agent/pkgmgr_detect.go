package main

import (
	"os"
	"os/exec"
	"runtime"
)

// detectLinuxPatchManager picks the primary native package manager on this host.
func detectLinuxPatchManager() string {
	if _, err := exec.LookPath("pacman"); err == nil {
		return "pacman"
	}
	if _, err := exec.LookPath("apk"); err == nil {
		return "apk"
	}
	if _, err := exec.LookPath("zypper"); err == nil {
		return "zypper"
	}
	if _, err := exec.LookPath("dnf"); err == nil {
		return "dnf"
	}
	if _, err := exec.LookPath("yum"); err == nil {
		return "yum"
	}
	if _, err := exec.LookPath("apt-get"); err == nil {
		return "apt"
	}
	if _, err := exec.LookPath("emerge"); err == nil {
		return "emerge"
	}
	if _, err := exec.LookPath("rpm"); err == nil {
		return "dnf"
	}
	return "apt"
}

func defaultPatchManager() string {
	switch runtime.GOOS {
	case "windows":
		return "winget"
	case "darwin":
		if _, err := exec.LookPath("brew"); err == nil {
			return "brew"
		}
		return "apt"
	case "freebsd", "openbsd", "netbsd":
		if _, err := exec.LookPath("pkg"); err == nil {
			return "pkg"
		}
		return "apt"
	case "linux":
		return detectLinuxPatchManager()
	default:
		return "apt"
	}
}

func applyDefaultPatchManager(opts *patchUpgradeOpts) {
	if opts.manager == "" {
		opts.manager = defaultPatchManager()
	}
}

func pacmanPresent() bool {
	_, err := exec.LookPath("pacman")
	return err == nil
}

func apkPresent() bool {
	_, err := exec.LookPath("apk")
	return err == nil
}

func zypperPresent() bool {
	_, err := exec.LookPath("zypper")
	return err == nil
}

// skipRpmInventory avoids duplicate RPM DB rows when zypper owns the distro.
func skipRpmInventory() bool {
	return zypperPresent()
}

// skipDnfUpgrades when a non-RPM-primary manager owns updates (Arch/Alpine).
func skipDnfUpgrades() bool {
	return pacmanPresent() || apkPresent()
}

func runPkgCmd(sudo bool, name string, args ...string) ([]byte, error) {
	cmd := exec.Command(name, args...)
	if sudo && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", name}, args...)...)
	}
	return cmd.Output()
}

func runPkgCombined(sudo bool, name string, args ...string) ([]byte, error) {
	cmd := exec.Command(name, args...)
	if sudo && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", name}, args...)...)
	}
	return cmd.CombinedOutput()
}
