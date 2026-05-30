package main

import (
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
)

var linuxKernelUpstreamRe = regexp.MustCompile(`(\d+\.\d+\.\d+)`)

func linuxKernelUpstreamVersion(s string) string {
	m := linuxKernelUpstreamRe.FindStringSubmatch(strings.TrimSpace(s))
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}

func kernelImagesAligned(running, installed string) bool {
	running = strings.TrimSpace(running)
	installed = strings.TrimSpace(installed)
	if running == "" || installed == "" {
		return running == installed
	}
	if running == installed {
		return true
	}
	if strings.HasPrefix(running, installed) || strings.HasPrefix(installed, running) {
		return true
	}
	ru := linuxKernelUpstreamVersion(running)
	iu := linuxKernelUpstreamVersion(installed)
	if ru != "" && ru == iu {
		// Debian: uname 6.12.90+deb13.1-amd64 vs dpkg image 6.12.90-2 share upstream 6.12.90
		return true
	}
	return false
}

type pendingUpdate struct {
	name      string
	current   string
	available string
	manager   string
}

func collectKernelInfo(sudo bool) map[string]any {
	info := map[string]any{
		"running":        kernelRelease(),
		"updatePending":  false,
		"rebootRequired": rebootRequired(),
	}
	switch runtime.GOOS {
	case "linux":
		latest, pending := linuxKernelUpdateState(sudo)
		if latest != "" {
			info["latestInstalled"] = latest
		}
		if pending {
			info["updatePending"] = true
		}
		if info["rebootRequired"].(bool) || pending {
			info["updatePending"] = true
		}
	case "windows":
		// Pending reboot for Windows Update (best-effort registry)
		if windowsRebootPending() {
			info["updatePending"] = true
			info["rebootRequired"] = true
		}
	}
	return info
}

func kernelRelease() string {
	out, err := exec.Command("uname", "-r").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func linuxKernelUpdateState(sudo bool) (latestInstalled string, updatePending bool) {
	if pending := aptKernelUpgradesPending(sudo); pending {
		return "", true
	}
	if hostRebootRequired() {
		latest := newestInstalledKernelImage(sudo)
		return latest, true
	}
	running := kernelRelease()
	if running == "" {
		return "", false
	}
	latest := newestInstalledKernelImage(sudo)
	if latest == "" {
		return "", false
	}
	if kernelImagesAligned(running, latest) {
		return latest, false
	}
	return latest, true
}

func aptKernelUpgradesPending(sudo bool) bool {
	if _, err := exec.LookPath("apt-get"); err != nil {
		return false
	}
	args := []string{"list", "--upgradable"}
	cmd := exec.Command("apt-get", args...)
	if sudo && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", "apt-get"}, args...)...)
	}
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(out), "\n") {
		lower := strings.ToLower(line)
		if strings.Contains(lower, "linux-image") ||
			strings.Contains(lower, "linux-headers") ||
			strings.Contains(lower, "linux-generic") ||
			strings.Contains(lower, "linux-virtual") {
			return true
		}
	}
	return false
}

func newestInstalledKernelImage(sudo bool) string {
	if _, err := exec.LookPath("dpkg-query"); err != nil {
		return ""
	}
	args := []string{"-W", "-f", "${Version}\n", "linux-image-*"}
	cmd := exec.Command("dpkg-query", args...)
	if sudo && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", "dpkg-query"}, args...)...)
	}
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	var best string
	for _, line := range strings.Split(string(out), "\n") {
		ver := strings.TrimSpace(line)
		if ver == "" {
			continue
		}
		if ver > best {
			best = ver
		}
	}
	return best
}

func windowsRebootPending() bool {
	ps := `(Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired' -ErrorAction SilentlyContinue) -ne $null`
	out, err := exec.Command("powershell", "-NoProfile", "-Command", ps).Output()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(out)) == "True"
}

func collectPendingUpdates(sudo bool) []pendingUpdate {
	switch runtime.GOOS {
	case "linux":
		var all []pendingUpdate
		all = append(all, collectAptUpgradable(sudo)...)
		if !skipDnfUpgrades() {
			all = append(all, collectDnfUpgradable(sudo)...)
		}
		all = append(all, collectZypperUpgradable(sudo)...)
		all = append(all, collectPacmanUpgradable(sudo)...)
		all = append(all, collectApkUpgradable(sudo)...)
		all = append(all, collectEmergeUpgradable(sudo)...)
		all = append(all, collectSnapUpgradable()...)
		return all
	case "windows":
		return collectWingetUpgradable()
	case "darwin":
		return collectBrewUpgradable()
	case "freebsd", "openbsd", "netbsd":
		return collectPkgUpgradable(sudo)
	default:
		return nil
	}
}

func collectAptUpgradable(sudo bool) []pendingUpdate {
	if _, err := exec.LookPath("apt-get"); err != nil {
		return nil
	}
	_ = runQuiet(sudo, "apt-get", "update", "-qq")
	args := []string{"list", "--upgradable"}
	cmd := exec.Command("apt-get", args...)
	if sudo && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", "apt-get"}, args...)...)
	}
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	var rows []pendingUpdate
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Listing") || strings.HasPrefix(line, "WARNING") {
			continue
		}
		// pkg/arch ver [upgradable from: old]
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := strings.Split(fields[0], "/")[0]
		available := fields[1]
		current := ""
		if idx := strings.Index(line, "upgradable from:"); idx >= 0 {
			rest := strings.TrimSpace(line[idx+len("upgradable from:"):])
			rest = strings.TrimSuffix(rest, "]")
			current = strings.Fields(rest)[0]
		}
		if strings.HasPrefix(name, "linux-image") || strings.HasPrefix(name, "linux-headers") {
			continue // kernel tracked separately
		}
		rows = append(rows, pendingUpdate{
			name:      name,
			current:   current,
			available: available,
			manager:   "dpkg",
		})
		if len(rows) >= 800 {
			break
		}
	}
	return rows
}

func collectDnfUpgradable(sudo bool) []pendingUpdate {
	bin := ""
	if p, err := exec.LookPath("dnf"); err == nil {
		bin = p
	} else if p, err := exec.LookPath("yum"); err == nil {
		bin = p
	} else {
		return nil
	}
	args := []string{"check-update", "-q", "--refresh"}
	cmd := exec.Command(bin, args...)
	if sudo && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", bin}, args...)...)
	}
	out, err := cmd.CombinedOutput()
	// dnf exits 100 when updates available
	if err != nil {
		if !strings.Contains(err.Error(), "exit status 100") {
			return nil
		}
	}
	var rows []pendingUpdate
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Last") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := fields[0]
		available := fields[1]
		if name == "" || available == "" {
			continue
		}
		rows = append(rows, pendingUpdate{
			name:      name,
			current:   "",
			available: available,
			manager:   "dnf",
		})
		if len(rows) >= 800 {
			break
		}
	}
	return rows
}

func collectSnapUpgradable() []pendingUpdate {
	if _, err := exec.LookPath("snap"); err != nil {
		return nil
	}
	out, err := exec.Command("snap", "refresh", "--list").Output()
	if err != nil {
		return nil
	}
	var rows []pendingUpdate
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.Contains(line, "rev") && !strings.Contains(line, "base") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		name := fields[0]
		if name == "Name" {
			continue
		}
		rows = append(rows, pendingUpdate{
			name:      name,
			current:   fields[1],
			available: fields[2],
			manager:   "snap",
		})
		if len(rows) >= 200 {
			break
		}
	}
	return rows
}

func collectWingetUpgradable() []pendingUpdate {
	if _, err := exec.LookPath("winget"); err != nil {
		return nil
	}
	out, err := exec.Command(
		"winget", "upgrade",
		"--disable-interactivity",
		"--include-unknown",
		"--output", "json",
	).Output()
	if err != nil {
		return nil
	}
	// Minimal parse: look for "Id" and "Version" / "AvailableVersion" in JSON lines
	var rows []pendingUpdate
	var curID, curVer, curAvail string
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.Contains(line, `"Id"`) {
			curID = jsonStringField(line)
		}
		if strings.Contains(line, `"InstalledVersion"`) || strings.Contains(line, `"Version"`) {
			if !strings.Contains(line, "Available") {
				curVer = jsonStringField(line)
			}
		}
		if strings.Contains(line, `"AvailableVersion"`) {
			curAvail = jsonStringField(line)
			if curID != "" && curAvail != "" && curAvail != curVer {
				rows = append(rows, pendingUpdate{
					name:      curID,
					current:   curVer,
					available: curAvail,
					manager:   "winget",
				})
			}
			curID, curVer, curAvail = "", "", ""
		}
		if len(rows) >= 400 {
			break
		}
	}
	return rows
}

func jsonStringField(line string) string {
	i := strings.Index(line, ":")
	if i < 0 {
		return ""
	}
	v := strings.TrimSpace(line[i+1:])
	v = strings.Trim(v, `",`)
	return v
}

func applyPendingToPackages(packages []map[string]any, pending []pendingUpdate) {
	if len(pending) == 0 {
		return
	}
	byKey := make(map[string]pendingUpdate)
	for _, p := range pending {
		byKey[p.name+"\x00"+p.manager] = p
		byKey[p.name] = p // fallback match by name only
	}
	for _, pkg := range packages {
		name, _ := pkg["name"].(string)
		manager, _ := pkg["manager"].(string)
		if pu, ok := byKey[name+"\x00"+manager]; ok {
			pkg["updateAvailable"] = true
			if pu.available != "" {
				pkg["availableVersion"] = pu.available
			}
			continue
		}
		if pu, ok := byKey[name]; ok {
			pkg["updateAvailable"] = true
			if pu.available != "" {
				pkg["availableVersion"] = pu.available
			}
		}
	}
}
