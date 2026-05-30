package main

import (
	"os/exec"
	"strings"
)

func collectEmergePackages() []map[string]any {
	if _, err := exec.LookPath("qlist"); err != nil {
		return nil
	}
	out, err := exec.Command("qlist", "-Iv").Output()
	if err != nil {
		return nil
	}
	var rows []map[string]any
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// category/name-version
		slash := strings.Index(line, "/")
		if slash < 0 {
			continue
		}
		rest := line[slash+1:]
		dash := strings.LastIndex(rest, "-")
		if dash <= 0 {
			continue
		}
		name := line[:slash] + "/" + rest[:dash]
		version := rest[dash+1:]
		rows = append(rows, map[string]any{
			"name":    name,
			"version": version,
			"manager": "emerge",
			"source":  "installed",
		})
		if len(rows) >= 2000 {
			break
		}
	}
	return rows
}

func collectEmergeUpgradable(sudo bool) []pendingUpdate {
	if _, err := exec.LookPath("emerge"); err != nil {
		return nil
	}
	out, err := runPkgCombined(sudo, "emerge", "-pv", "--update", "--deep", "@world")
	if err != nil && len(bytesTrim(out)) == 0 {
		return nil
	}
	var rows []pendingUpdate
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if !strings.Contains(line, "[ebuild") {
			continue
		}
		// [ebuild  N  ] category/name-version
		idx := strings.Index(line, "]")
		if idx < 0 {
			continue
		}
		rest := strings.TrimSpace(line[idx+1:])
		fields := strings.Fields(rest)
		if len(fields) == 0 {
			continue
		}
		full := fields[0]
		slash := strings.Index(full, "/")
		if slash < 0 {
			continue
		}
		dash := strings.LastIndex(full, "-")
		if dash <= slash {
			continue
		}
		name := full[:dash]
		available := full[dash+1:]
		rows = append(rows, pendingUpdate{
			name:      name,
			current:   "",
			available: available,
			manager:   "emerge",
		})
		if len(rows) >= 400 {
			break
		}
	}
	return rows
}
