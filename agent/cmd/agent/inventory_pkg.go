package main

import (
	"os/exec"
	"runtime"
	"strings"
)

func bsdPkgSupported() bool {
	switch runtime.GOOS {
	case "freebsd", "openbsd", "netbsd":
		return true
	default:
		return false
	}
}

func collectPkgPackages() []map[string]any {
	if !bsdPkgSupported() {
		return nil
	}
	if _, err := exec.LookPath("pkg"); err != nil {
		return nil
	}
	out, err := exec.Command("pkg", "query", "%n\t%v\n").Output()
	if err != nil {
		return nil
	}
	return parsePackageLines(string(out), "pkg", "installed")
}

func collectPkgUpgradable(sudo bool) []pendingUpdate {
	if !bsdPkgSupported() {
		return nil
	}
	if _, err := exec.LookPath("pkg"); err != nil {
		return nil
	}
	_, _ = runPkgCombined(sudo, "pkg", "update", "-q")
	out, err := runPkgCombined(sudo, "pkg", "version", "-v", "<")
	if err != nil && len(bytesTrim(out)) == 0 {
		return nil
	}
	var rows []pendingUpdate
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// name < installed [ports_version:]
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := fields[0]
		current := fields[1]
		available := ""
		if len(fields) >= 3 {
			available = strings.TrimPrefix(fields[2], "[")
			available = strings.TrimSuffix(available, "]")
			available = strings.TrimSuffix(available, ":")
		}
		rows = append(rows, pendingUpdate{
			name:      name,
			current:   current,
			available: available,
			manager:   "pkg",
		})
		if len(rows) >= 800 {
			break
		}
	}
	return rows
}
