package main

import (
	"os/exec"
	"regexp"
	"strings"
)

var apkPkgRe = regexp.MustCompile(`^(.+)-(\d[\w.]*-r\d+)$`)

func collectApkPackages() []map[string]any {
	if _, err := exec.LookPath("apk"); err != nil {
		return nil
	}
	out, err := exec.Command("apk", "list", "-I").Output()
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
		if len(fields) == 0 {
			continue
		}
		name, version, ok := parseApkPackageToken(fields[0])
		if !ok {
			continue
		}
		rows = append(rows, map[string]any{
			"name":    name,
			"version": version,
			"manager": "apk",
			"source":  "installed",
		})
		if len(rows) >= 2000 {
			break
		}
	}
	return rows
}

func parseApkPackageToken(token string) (name, version string, ok bool) {
	m := apkPkgRe.FindStringSubmatch(token)
	if len(m) == 3 {
		return m[1], m[2], true
	}
	// fallback: last -r segment
	idx := strings.LastIndex(token, "-r")
	if idx <= 0 {
		return "", "", false
	}
	mid := strings.LastIndex(token[:idx], "-")
	if mid <= 0 {
		return "", "", false
	}
	return token[:mid], token[mid+1:], true
}

func collectApkUpgradable(sudo bool) []pendingUpdate {
	if _, err := exec.LookPath("apk"); err != nil {
		return nil
	}
	_, _ = runPkgCombined(sudo, "apk", "update", "--quiet")
	out, err := runPkgCombined(sudo, "apk", "version", "-l", "<")
	if err != nil && len(bytesTrim(out)) == 0 {
		return nil
	}
	return parseApkVersionOutput(string(out))
}

func parseApkVersionOutput(out string) []pendingUpdate {
	var rows []pendingUpdate
	var currentName, currentVer, available string
	flush := func() {
		if currentName == "" || available == "" {
			currentName, currentVer, available = "", "", ""
			return
		}
		rows = append(rows, pendingUpdate{
			name:      currentName,
			current:   currentVer,
			available: available,
			manager:   "apk",
		})
		currentName, currentVer, available = "", "", ""
	}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		lower := strings.ToLower(line)
		if strings.HasPrefix(lower, "installed:") {
			flush()
			tok := strings.TrimSpace(line[len("Installed:"):])
			currentName, currentVer, _ = parseApkPackageToken(tok)
			if currentName == "" {
				currentName = tok
			}
			continue
		}
		if strings.HasPrefix(lower, "available:") || strings.HasPrefix(lower, "candidate:") {
			tok := strings.TrimSpace(line[strings.Index(line, ":")+1:])
			_, available, _ = parseApkPackageToken(tok)
			if available == "" {
				available = tok
			}
		}
	}
	flush()
	if len(rows) > 800 {
		return rows[:800]
	}
	return rows
}

func bytesTrim(b []byte) []byte {
	return []byte(strings.TrimSpace(string(b)))
}
