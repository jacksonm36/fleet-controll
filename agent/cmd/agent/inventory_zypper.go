package main

import (
	"os/exec"
	"strings"
)

func collectZypperPackages() []map[string]any {
	if _, err := exec.LookPath("zypper"); err != nil {
		return nil
	}
	out, err := exec.Command("zypper", "-n", "search", "-i", "-s").Output()
	if err != nil {
		return collectRpmPackagesWithManager("zypper")
	}
	var rows []map[string]any
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "S |") || strings.HasPrefix(line, "--") {
			continue
		}
		if strings.Contains(line, "Name") && strings.Contains(line, "Version") {
			continue
		}
		fields := strings.Fields(line)
		// Status | Name | Type | Version | Arch | Repository
		if len(fields) < 4 {
			continue
		}
		status := fields[0]
		if status != "i" && !strings.HasPrefix(status, "i") {
			continue
		}
		name := fields[1]
		version := fields[3]
		if name == "" || version == "" {
			continue
		}
		rows = append(rows, map[string]any{
			"name":    name,
			"version": version,
			"manager": "zypper",
			"source":  "installed",
		})
		if len(rows) >= 2000 {
			break
		}
	}
	if len(rows) == 0 {
		return collectRpmPackagesWithManager("zypper")
	}
	return rows
}

func collectRpmPackagesWithManager(manager string) []map[string]any {
	if _, err := exec.LookPath("rpm"); err != nil {
		return nil
	}
	out, err := exec.Command("rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\n").Output()
	if err != nil {
		return nil
	}
	rows := parsePackageLines(string(out), manager, "installed")
	return rows
}

func collectZypperUpgradable(sudo bool) []pendingUpdate {
	if _, err := exec.LookPath("zypper"); err != nil {
		return nil
	}
	out, err := runPkgCombined(sudo, "zypper", "-n", "list-updates")
	if err != nil && len(bytesTrim(out)) == 0 {
		return nil
	}
	var rows []pendingUpdate
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Loading") || strings.HasPrefix(line, "Repository") {
			continue
		}
		if strings.Contains(line, "|") {
			fields := strings.Split(line, "|")
			if len(fields) < 4 {
				continue
			}
			name := strings.TrimSpace(fields[2])
			current := strings.TrimSpace(fields[3])
			available := ""
			if len(fields) > 4 {
				available = strings.TrimSpace(fields[4])
			}
			if name == "" || name == "Name" {
				continue
			}
			rows = append(rows, pendingUpdate{
				name:      name,
				current:   current,
				available: available,
				manager:   "zypper",
			})
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		rows = append(rows, pendingUpdate{
			name:      fields[0],
			current:   fields[1],
			available: fields[2],
			manager:   "zypper",
		})
		if len(rows) >= 800 {
			break
		}
	}
	return rows
}
