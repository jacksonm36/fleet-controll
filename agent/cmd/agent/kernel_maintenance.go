package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

type kernelMaintenanceResult struct {
	InstalledPackages []string `json:"installedPackages"`
	InstalledCount    int      `json:"installedCount"`
	RunningKernel     string   `json:"runningKernel"`
	Rebooted          bool     `json:"rebooted"`
	RebootScheduled   bool     `json:"rebootScheduled"`
}

func isKernelRelatedPackage(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	return strings.HasPrefix(n, "linux-image") ||
		strings.HasPrefix(n, "linux-headers") ||
		strings.HasPrefix(n, "linux-generic") ||
		strings.HasPrefix(n, "linux-virtual") ||
		strings.HasPrefix(n, "linux-base")
}

func collectKernelAptUpgradable(sudo bool) ([]patchPlanEntry, error) {
	if _, err := exec.LookPath("apt-get"); err != nil {
		return nil, fmt.Errorf("apt-get not found")
	}
	if err := runQuiet(sudo, "apt-get", "update", "-qq"); err != nil {
		return nil, fmt.Errorf("apt-get update: %w", err)
	}
	args := []string{"list", "--upgradable"}
	out, err := runOutput(sudo, "apt-get", args...)
	if err != nil {
		return nil, err
	}
	var plan []patchPlanEntry
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Listing") || strings.HasPrefix(line, "WARNING") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := strings.Split(fields[0], "/")[0]
		if !isKernelRelatedPackage(name) {
			continue
		}
		available := fields[1]
		current := ""
		if idx := strings.Index(line, "upgradable from:"); idx >= 0 {
			rest := strings.TrimSpace(line[idx+len("upgradable from:"):])
			rest = strings.TrimSuffix(rest, "]")
			current = strings.Fields(rest)[0]
		}
		plan = append(plan, patchPlanEntry{
			Name:           name,
			CurrentVersion: current,
			TargetVersion:  available,
		})
	}
	return plan, nil
}

func kernelRebootNeeded(sudo bool) bool {
	if hostRebootRequired() {
		return true
	}
	running := kernelRelease()
	latest := newestInstalledKernelImage(sudo)
	if running == "" || latest == "" {
		return false
	}
	return latest != running && !strings.HasPrefix(running, latest)
}

func runHostKernelMaintenance(payload json.RawMessage, sudo bool, logFn func(string)) (kernelMaintenanceResult, error) {
	if runtime.GOOS != "linux" {
		return kernelMaintenanceResult{}, fmt.Errorf("kernel maintenance only supported on linux")
	}
	res := kernelMaintenanceResult{RunningKernel: kernelRelease()}

	plan, err := collectKernelAptUpgradable(sudo)
	if err != nil {
		return res, err
	}

	if len(plan) > 0 {
		logFn(fmt.Sprintf("Installing %d kernel-related package(s)…", len(plan)))
		names := make([]string, 0, len(plan))
		for _, p := range plan {
			names = append(names, p.Name)
			logFn(fmt.Sprintf("  %s %s -> %s", p.Name, p.CurrentVersion, p.TargetVersion))
		}
		args := append([]string{"install", "-y"}, names...)
		out, err := runOutput(sudo, "apt-get", args...)
		if out != "" {
			for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
				if strings.TrimSpace(line) != "" {
					logFn(line)
				}
			}
		}
		if err != nil {
			return res, fmt.Errorf("apt-get install kernel packages: %w", err)
		}
		res.InstalledPackages = names
		res.InstalledCount = len(names)
	} else {
		logFn("No kernel packages pending via apt — checking if reboot is required for an installed kernel…")
	}

	if !kernelRebootNeeded(sudo) && len(plan) == 0 {
		return res, fmt.Errorf("no kernel upgrades pending and reboot not required")
	}

	logFn("WARNING: rebooting host now to activate the new kernel")
	logFn(fmt.Sprintf("Running kernel before reboot: %s", res.RunningKernel))

	delaySec := 5
	if len(payload) > 0 {
		var p map[string]any
		if json.Unmarshal(payload, &p) == nil {
			if v, ok := p["rebootDelaySec"].(float64); ok && v >= 0 {
				delaySec = int(v)
			}
		}
	}

	if err := scheduleHostReboot(sudo, delaySec, logFn); err != nil {
		return res, err
	}
	res.RebootScheduled = true
	res.Rebooted = true
	return res, nil
}

func scheduleHostReboot(sudo bool, delaySec int, logFn func(string)) error {
	if delaySec < 1 {
		delaySec = 1
	}
	logFn(fmt.Sprintf("Scheduling reboot in %d second(s)…", delaySec))
	time.Sleep(time.Duration(delaySec) * time.Second)

	if _, err := exec.LookPath("systemctl"); err == nil {
		if err := runQuiet(sudo, "systemctl", "reboot"); err == nil {
			logFn("systemctl reboot issued")
			return nil
		}
	}
	if err := runQuiet(sudo, "shutdown", "-r", "now", "Fleet kernel maintenance reboot"); err == nil {
		logFn("shutdown -r now issued")
		return nil
	}
	// Last resort for agent running as root without systemctl
	if os.Geteuid() == 0 {
		return exec.Command("reboot").Start()
	}
	return fmt.Errorf("could not trigger reboot (systemctl/shutdown failed)")
}
