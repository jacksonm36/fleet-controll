package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func collectCrowdSecSnapshot() (map[string]any, bool) {
	cscli, err := exec.LookPath("cscli")
	if err != nil {
		return nil, false
	}

	alerts := any([]any{})
	if out, err := exec.Command(cscli, "alerts", "list", "-o", "json", "-l", "50").CombinedOutput(); err == nil {
		_ = json.Unmarshal(bytes.TrimSpace(out), &alerts)
	}

	decisions := any([]any{})
	if out, err := exec.Command(cscli, "decisions", "list", "-o", "json", "-l", "200").CombinedOutput(); err == nil {
		_ = json.Unmarshal(bytes.TrimSpace(out), &decisions)
	}

	version := ""
	if out, err := exec.Command(cscli, "version").CombinedOutput(); err == nil {
		version = strings.TrimSpace(string(out))
	}

	return map[string]any{
		"schemaVersion": 1,
		"capturedAt":    time.Now().UTC().Format(time.RFC3339),
		"healthy":       true,
		"version":       version,
		"alerts":        alerts,
		"decisions":     decisions,
		"bouncers":      []any{},
		"raw":           map[string]any{"cscli": cscli},
	}, true
}

func crowdsecInstalledHint() bool {
	_, err := exec.LookPath("cscli")
	return err == nil
}

func rebootRequired() bool {
	if runtime.GOOS == "linux" {
		_, err := os.Stat("/var/run/reboot-required")
		return err == nil
	}
	return false
}

func collectInventory(sudo bool) (map[string]any, error) {
	packages := collectPackages(sudo)
	pending := collectPendingUpdates(sudo)
	applyPendingToPackages(packages, pending)
	kernel := collectKernelInfo(sudo)

	services := collectServices(sudo)
	containers := collectContainers(sudo)

	reboot := false
	if v, ok := kernel["rebootRequired"].(bool); ok && v {
		reboot = true
	}
	if !reboot {
		reboot = rebootRequired()
	}

	vulns := collectVulnerabilities(sudo)
	primaryIP, ipAddresses := collectHostAddresses()
	host := map[string]any{}
	if primaryIP != "" {
		host["primaryIp"] = primaryIP
	}
	if len(ipAddresses) > 0 {
		host["addresses"] = ipAddresses
	}

	payload := map[string]any{
		"schemaVersion":          1,
		"collectedAt":            time.Now().UTC().Format(time.RFC3339),
		"packages":               packages,
		"services":               services,
		"containers":             containers,
		"kernel":                 kernel,
		"packageUpdatesPending":  len(pending),
		"vulnerabilities":        vulns,
		"osDetail":               collectOSDetail(),
		"rebootRequired":         reboot,
		"crowdsecInstalled":      crowdsecInstalledHint(),
		"host":                   host,
	}
	return payload, nil
}

func collectPackages(sudo bool) []map[string]any {
	switch runtime.GOOS {
	case "linux":
		return collectPackagesLinux(sudo)
	case "windows":
		return collectPackagesWindows()
	default:
		return []map[string]any{}
	}
}

func collectPackagesWindows() []map[string]any {
	if _, err := exec.LookPath("winget"); err != nil {
		return []map[string]any{}
	}
	cmd := exec.Command(
		"winget",
		"list",
		"--accept-source-agreements",
		"--disable-interactivity",
		"--output",
		"json",
	)
	out, err := cmd.Output()
	if err != nil {
		return []map[string]any{}
	}

	var root map[string]any
	if err := json.Unmarshal(out, &root); err != nil {
		return []map[string]any{}
	}

	rawPkgs, ok := root["Packages"].([]any)
	if !ok {
		return []map[string]any{}
	}

	var rows []map[string]any
	for _, item := range rawPkgs {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name, _ := m["Name"].(string)
		version, _ := m["Version"].(string)
		id, _ := m["Id"].(string)
		if name == "" {
			continue
		}
		rows = append(rows, map[string]any{
			"name":    name,
			"version": version,
			"manager": "winget",
			"source":  id,
		})
	}
	return rows
}

func collectServices(sudo bool) []map[string]any {
	switch runtime.GOOS {
	case "linux":
		return collectServicesLinuxImproved(sudo)
	case "windows":
		return collectServicesWindows()
	case "darwin":
		return collectServicesDarwin()
	default:
		return []map[string]any{}
	}
}

func collectServicesWindows() []map[string]any {
	ps := `$obj = Get-Service | Select-Object -First 350 Status,Name | ConvertTo-Json -Compress
Write-Output $obj`
	cmd := exec.Command("powershell", "-NoProfile", "-Command", ps)
	out, err := cmd.Output()
	if err != nil {
		return []map[string]any{}
	}

	trim := bytes.TrimSpace(out)
	if len(trim) == 0 {
		return []map[string]any{}
	}

	var decoded any
	if err := json.Unmarshal(trim, &decoded); err != nil {
		return []map[string]any{}
	}

	toMaps := func(item map[string]any) map[string]any {
		name, _ := item["Name"].(string)
		status, _ := item["Status"].(string)
		return map[string]any{
			"name":    name,
			"kind":    "windows_service",
			"state":   strings.ToLower(status),
			"enabled": strings.EqualFold(status, "Running"),
		}
	}

	switch v := decoded.(type) {
	case map[string]any:
		return []map[string]any{toMaps(v)}
	case []any:
		var rows []map[string]any
		for _, it := range v {
			m, ok := it.(map[string]any)
			if !ok {
				continue
			}
			rows = append(rows, toMaps(m))
		}
		return rows
	default:
		return []map[string]any{}
	}
}

func collectOSDetail() string {
	if runtime.GOOS != "linux" {
		return runtime.GOARCH
	}
	b, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return runtime.GOARCH
	}
	return strings.TrimSpace(string(b))
}

func defaultTokenPath() string {
	dir, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", "fleet.agent.token")
	}
	return filepath.Join(dir, ".fleet-agent.token")
}

func getenvDefault(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func autoSudoDefault() string {
	if runtime.GOOS == "linux" {
		return "true"
	}
	return "false"
}

func flagString(name, def string) string {
	prefix := "-" + name + "="
	for _, arg := range os.Args[1:] {
		if strings.HasPrefix(arg, prefix) {
			return strings.TrimPrefix(arg, prefix)
		}
	}
	return def
}
