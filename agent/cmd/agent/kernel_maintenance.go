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
	LatestInstalled   string   `json:"latestInstalled,omitempty"`
	Rebooted          bool     `json:"rebooted"`
	RebootScheduled   bool     `json:"rebootScheduled"`
	RebootOnly        bool     `json:"rebootOnly"`
}

func isKernelRelatedPackage(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	return strings.HasPrefix(n, "linux-image") ||
		strings.HasPrefix(n, "linux-headers") ||
		strings.HasPrefix(n, "linux-generic") ||
		strings.HasPrefix(n, "linux-virtual") ||
		strings.HasPrefix(n, "linux-base")
}

func debianArch(sudo bool) string {
	out, err := runOutput(sudo, "dpkg", "--print-architecture")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

func collectKernelAptUpgradable(sudo bool, logFn func(string)) ([]patchPlanEntry, error) {
	if _, err := exec.LookPath("apt-get"); err != nil {
		return nil, fmt.Errorf("apt-get not found")
	}
	if err := runQuiet(sudo, "apt-get", "update", "-qq"); err != nil {
		if logFn != nil {
			logFn(fmt.Sprintf("warning: apt-get update: %v (continuing)", err))
		}
	}
	out, err := runOutput(sudo, "apt-get", "list", "--upgradable")
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

func kernelNeedsReboot(sudo bool) bool {
	if hostRebootRequired() {
		return true
	}
	_, pending := linuxKernelUpdateState(sudo)
	return pending
}

func defaultKernelMetapackages(sudo bool) []string {
	arch := debianArch(sudo)
	if arch == "" {
		return nil
	}
	return []string{
		"linux-image-" + arch,
		"linux-headers-" + arch,
	}
}

func installKernelPackages(sudo bool, names []string, logFn func(string)) error {
	if len(names) == 0 {
		return nil
	}
	logFn(fmt.Sprintf("Installing %d kernel-related package(s)…", len(names)))
	for _, name := range names {
		logFn(fmt.Sprintf("  → %s", name))
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
		return fmt.Errorf("apt-get install kernel packages: %w", err)
	}
	return nil
}

func parseKernelMaintenancePayload(payload json.RawMessage) (rebootOnly bool, delaySec int) {
	delaySec = 5
	if len(payload) == 0 {
		return false, delaySec
	}
	var p map[string]any
	if json.Unmarshal(payload, &p) != nil {
		return false, delaySec
	}
	if v, ok := p["rebootOnly"].(bool); ok {
		rebootOnly = v
	}
	if v, ok := p["rebootDelaySec"].(float64); ok && v >= 0 {
		delaySec = int(v)
	}
	return rebootOnly, delaySec
}

func runHostKernelMaintenance(payload json.RawMessage, sudo bool, logFn func(string)) (kernelMaintenanceResult, error) {
	if runtime.GOOS != "linux" {
		return kernelMaintenanceResult{}, fmt.Errorf("kernel maintenance only supported on linux")
	}
	res := kernelMaintenanceResult{RunningKernel: kernelRelease()}
	latest, _ := linuxKernelUpdateState(sudo)
	res.LatestInstalled = latest

	rebootOnly, delaySec := parseKernelMaintenancePayload(payload)
	needsReboot := kernelNeedsReboot(sudo)

	var names []string
	if !rebootOnly {
		plan, err := collectKernelAptUpgradable(sudo, logFn)
		if err != nil {
			return res, err
		}
		names = make([]string, 0, len(plan))
		for _, p := range plan {
			names = append(names, p.Name)
		}
		if len(names) == 0 && aptKernelUpgradesPending(sudo) {
			meta := defaultKernelMetapackages(sudo)
			if len(meta) > 0 {
				logFn("Kernel updates listed by apt but no package lines parsed — trying image metapackages")
				names = meta
			}
		}
		if len(names) > 0 {
			if err := installKernelPackages(sudo, names, logFn); err != nil {
				return res, err
			}
			res.InstalledPackages = names
			res.InstalledCount = len(names)
		} else {
			logFn("No kernel packages to install via apt")
		}
	} else {
		logFn("Reboot-only: skipping apt kernel package install")
		res.RebootOnly = true
	}

	if !needsReboot && len(names) == 0 && !rebootOnly {
		return res, fmt.Errorf("no kernel upgrades pending and reboot not required")
	}
	if len(names) == 0 && (needsReboot || rebootOnly) {
		res.RebootOnly = true
		logFn("A newer kernel is already installed — reboot required to activate it")
	}

	logFn("WARNING: rebooting host now to activate the kernel")
	logFn(fmt.Sprintf("Running kernel before reboot: %s", res.RunningKernel))
	if res.LatestInstalled != "" {
		logFn(fmt.Sprintf("Latest installed kernel image version: %s", res.LatestInstalled))
	}

	if err := scheduleHostRebootAsync(sudo, delaySec, logFn); err != nil {
		return res, err
	}
	res.RebootScheduled = true
	res.Rebooted = true
	return res, nil
}

func scheduleHostRebootAsync(sudo bool, delaySec int, logFn func(string)) error {
	if delaySec < 1 {
		delaySec = 1
	}
	logFn(fmt.Sprintf("Scheduling reboot in %d second(s) (job will complete before reboot)…", delaySec))
	go func() {
		time.Sleep(time.Duration(delaySec) * time.Second)
		if _, err := exec.LookPath("systemctl"); err == nil {
			if err := runQuiet(sudo, "systemctl", "reboot"); err == nil {
				return
			}
		}
		_ = runQuiet(sudo, "shutdown", "-r", "now", "Fleet kernel maintenance reboot")
		if os.Geteuid() == 0 {
			_ = exec.Command("reboot").Start()
		}
	}()
	return nil
}
