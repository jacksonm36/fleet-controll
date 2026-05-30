package main

import (
	"os"
	"os/exec"
	"strings"
)

func collectPacmanPackages() []map[string]any {
	if _, err := exec.LookPath("pacman"); err != nil {
		return nil
	}
	out, err := exec.Command("pacman", "-Q").Output()
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
			"manager": "pacman",
			"source":  "installed",
		})
		if len(rows) >= 2000 {
			break
		}
	}
	return rows
}

func collectPacmanUpgradable(sudo bool) []pendingUpdate {
	if _, err := exec.LookPath("pacman"); err != nil {
		return nil
	}
	args := []string{"-Qu"}
	cmd := exec.Command("pacman", args...)
	if sudo && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", "pacman"}, args...)...)
	}
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	var rows []pendingUpdate
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		name, current, available, ok := parsePacmanUpgradeLine(line)
		if !ok {
			continue
		}
		if strings.HasPrefix(name, "linux") {
			continue
		}
		rows = append(rows, pendingUpdate{
			name:      name,
			current:   current,
			available: available,
			manager:   "pacman",
		})
		if len(rows) >= 800 {
			break
		}
	}
	return rows
}

func parsePacmanUpgradeLine(line string) (name, current, available string, ok bool) {
	arrow := strings.Index(line, "->")
	if arrow < 0 {
		return "", "", "", false
	}
	left := strings.TrimSpace(line[:arrow])
	right := strings.TrimSpace(line[arrow+2:])
	leftFields := strings.Fields(left)
	if len(leftFields) < 2 {
		return "", "", "", false
	}
	return leftFields[0], leftFields[1], right, true
}
