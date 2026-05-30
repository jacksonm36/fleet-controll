package main

import (
	"os/exec"
	"runtime"
	"strings"
)

func collectBrewPackages() []map[string]any {
	if runtime.GOOS != "darwin" {
		return nil
	}
	if _, err := exec.LookPath("brew"); err != nil {
		return nil
	}
	out, err := exec.Command("brew", "list", "--versions").Output()
	if err != nil {
		return nil
	}
	var rows []map[string]any
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := fields[0]
		version := strings.Join(fields[1:], " ")
		rows = append(rows, map[string]any{
			"name":    name,
			"version": version,
			"manager": "brew",
			"source":  "installed",
		})
		if len(rows) >= 2000 {
			break
		}
	}
	return rows
}

func collectBrewUpgradable() []pendingUpdate {
	if runtime.GOOS != "darwin" {
		return nil
	}
	if _, err := exec.LookPath("brew"); err != nil {
		return nil
	}
	out, err := exec.Command("brew", "outdated", "--quiet").Output()
	if err != nil {
		return nil
	}
	var rows []pendingUpdate
	for _, line := range strings.Split(string(out), "\n") {
		name := strings.TrimSpace(line)
		if name == "" {
			continue
		}
		rows = append(rows, pendingUpdate{
			name:      name,
			current:   "",
			available: "",
			manager:   "brew",
		})
		if len(rows) >= 500 {
			break
		}
	}
	return rows
}
