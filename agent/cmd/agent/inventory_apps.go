package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// collectPackagesLinux gathers OS packages plus snap, flatpak, and container images.
func collectPackagesLinux(sudo bool) []map[string]any {
	var rows []map[string]any
	rows = append(rows, collectDpkgPackages()...)
	rows = append(rows, collectRpmPackages()...)
	rows = append(rows, collectSnapPackages()...)
	rows = append(rows, collectFlatpakPackages()...)
	rows = append(rows, collectDockerImages()...)
	rows = append(rows, collectPodmanImages()...)
	return rows
}

func collectDpkgPackages() []map[string]any {
	if _, err := exec.LookPath("dpkg-query"); err != nil {
		return nil
	}
	out, err := exec.Command("dpkg-query", "-W", "-f", `${Package}\t${Version}\n`).Output()
	if err != nil {
		return nil
	}
	return parsePackageLines(string(out), "dpkg", "installed")
}

func collectRpmPackages() []map[string]any {
	if _, err := exec.LookPath("rpm"); err != nil {
		return nil
	}
	out, err := exec.Command("rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\n").Output()
	if err != nil {
		return nil
	}
	return parsePackageLines(string(out), "rpm", "installed")
}

func collectSnapPackages() []map[string]any {
	if _, err := exec.LookPath("snap"); err != nil {
		return nil
	}
	out, err := exec.Command("snap", "list", "--color=never").Output()
	if err != nil {
		return nil
	}
	lines := strings.Split(string(out), "\n")
	var rows []map[string]any
	for i, line := range lines {
		if i == 0 || strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := fields[0]
		if name == "Name" {
			continue
		}
		version := fields[1]
		rows = append(rows, map[string]any{
			"name":    name,
			"version": version,
			"manager": "snap",
			"source":  "snap",
		})
		if len(rows) >= 500 {
			break
		}
	}
	return rows
}

func collectFlatpakPackages() []map[string]any {
	if _, err := exec.LookPath("flatpak"); err != nil {
		return nil
	}
	out, err := exec.Command("flatpak", "list", "--columns=application,version", "--plain").Output()
	if err != nil {
		return nil
	}
	var rows []map[string]any
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 2)
		name := parts[0]
		version := ""
		if len(parts) > 1 {
			version = parts[1]
		}
		rows = append(rows, map[string]any{
			"name":    name,
			"version": version,
			"manager": "flatpak",
			"source":  "flatpak",
		})
		if len(rows) >= 500 {
			break
		}
	}
	return rows
}

func collectDockerImages() []map[string]any {
	docker, err := exec.LookPath("docker")
	if err != nil {
		return nil
	}
	out, err := exec.Command(docker, "images", "--format", "{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}").Output()
	if err != nil {
		return nil
	}
	return parseImageLines(string(out), "docker")
}

func collectPodmanImages() []map[string]any {
	podman, err := exec.LookPath("podman")
	if err != nil {
		return nil
	}
	out, err := exec.Command(podman, "images", "--format", "{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}").Output()
	if err != nil {
		return nil
	}
	return parseImageLines(string(out), "podman")
}

func parseImageLines(out, manager string) []map[string]any {
	var rows []map[string]any
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "<none>") {
			continue
		}
		parts := strings.SplitN(line, "\t", 3)
		name := parts[0]
		if name == "" || name == "<none>:<none>" {
			continue
		}
		version := ""
		if len(parts) > 1 {
			version = parts[1]
		}
		rows = append(rows, map[string]any{
			"name":    name,
			"version": version,
			"manager": manager + "_image",
			"source":  manager,
		})
		if len(rows) >= 300 {
			break
		}
	}
	return rows
}

func parsePackageLines(out, manager, source string) []map[string]any {
	var rows []map[string]any
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) != 2 {
			continue
		}
		rows = append(rows, map[string]any{
			"name":    parts[0],
			"version": parts[1],
			"manager": manager,
			"source":  source,
		})
	}
	return rows
}

func collectContainers(sudo bool) []map[string]any {
	switch runtime.GOOS {
	case "linux":
		return collectContainersLinux(sudo)
	default:
		return []map[string]any{}
	}
}

func collectContainersLinux(sudo bool) []map[string]any {
	var rows []map[string]any
	rows = append(rows, collectRuntimeContainers("docker", sudo)...)
	// Podman only if docker didn't return rows or both installed
	if podmanRows := collectRuntimeContainers("podman", sudo); len(podmanRows) > 0 {
		rows = append(rows, podmanRows...)
	}
	return rows
}

func collectRuntimeContainers(runtime string, sudo bool) []map[string]any {
	bin, err := exec.LookPath(runtime)
	if err != nil {
		return nil
	}
	args := []string{
		"ps", "-a",
		"--format", "{{.Names}}\t{{.Image}}\t{{.ID}}\t{{.Status}}\t{{.Ports}}\t{{.Label \"com.docker.compose.project\"}}",
	}
	cmd := exec.Command(bin, args...)
	if sudo && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", bin}, args...)...)
	}
	out, err := cmd.Output()
	if err != nil {
		// Older docker without compose label — retry simpler format
		args = []string{"ps", "-a", "--format", "{{.Names}}\t{{.Image}}\t{{.ID}}\t{{.Status}}\t{{.Ports}}"}
		cmd = exec.Command(bin, args...)
		if sudo && os.Geteuid() != 0 {
			cmd = exec.Command("sudo", append([]string{"-n", bin}, args...)...)
		}
		out, err = cmd.Output()
		if err != nil {
			return nil
		}
	}

	var rows []map[string]any
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 6)
		if len(parts) < 4 {
			continue
		}
		name := parts[0]
		if name == "" {
			continue
		}
		image := parts[1]
		if strings.TrimSpace(image) == "" {
			image = "unknown"
		}
		row := map[string]any{
			"name":    name,
			"image":   image,
			"imageId": parts[2],
			"runtime": runtime,
			"status":  parts[3],
		}
		if len(parts) > 4 && strings.TrimSpace(parts[4]) != "" {
			row["ports"] = parts[4]
		}
		if len(parts) > 5 && strings.TrimSpace(parts[5]) != "" {
			row["composeProject"] = parts[5]
		}
		rows = append(rows, row)
		if len(rows) >= 500 {
			break
		}
	}
	return rows
}

// collectServicesLinuxImproved uses unit-files + list-units for accurate enabled/active state.
func collectServicesLinuxImproved(sudo bool) []map[string]any {
	enabled := map[string]string{}
	if rows := systemctlOutput(sudo, "list-unit-files", "--type=service", "--no-pager", "--no-legend"); rows != nil {
		for _, line := range strings.Split(string(rows), "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}
			unit := fields[0]
			state := fields[1]
			enabled[unit] = state
		}
	}

	out := systemctlOutput(sudo, "list-units", "--type=service", "--all", "--no-pager", "--no-legend")
	if out == nil {
		return collectServicesLinuxLegacy(sudo)
	}

	var rows []map[string]any
	seen := map[string]bool{}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 1 {
			continue
		}
		name := fields[0]
		active := "unknown"
		sub := ""
		if len(fields) >= 4 {
			active = fields[3]
		}
		if len(fields) >= 5 {
			sub = fields[4]
		}
		unitFile := enabled[name]
		detail := sub
		if unitFile != "" {
			if detail != "" {
				detail = sub + " · " + unitFile
			} else {
				detail = unitFile
			}
		}
		isEnabled := strings.EqualFold(unitFile, "enabled") ||
			strings.EqualFold(unitFile, "enabled-runtime") ||
			strings.EqualFold(active, "active")

		rows = append(rows, map[string]any{
			"name":    name,
			"kind":    "systemd",
			"state":   active,
			"enabled": isEnabled,
			"detail":  detail,
		})
		seen[name] = true
		if len(rows) >= 600 {
			break
		}
	}

	// Units that exist but are not loaded
	for unit, fileState := range enabled {
		if seen[unit] || !strings.HasSuffix(unit, ".service") {
			continue
		}
		rows = append(rows, map[string]any{
			"name":    unit,
			"kind":    "systemd",
			"state":   "inactive",
			"enabled": strings.EqualFold(fileState, "enabled"),
			"detail":  fileState,
		})
		if len(rows) >= 700 {
			break
		}
	}

	rows = append(rows, collectSnapServices()...)
	return dedupeServices(rows)
}

func dedupeServices(rows []map[string]any) []map[string]any {
	seen := make(map[string]struct{})
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		name, _ := row["name"].(string)
		kind, _ := row["kind"].(string)
		key := name + "\x00" + kind
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, row)
	}
	return out
}

func collectServicesLinuxLegacy(sudo bool) []map[string]any {
	return collectServicesLinux(sudo)
}

func systemctlOutput(sudo bool, args ...string) []byte {
	systemctl := "systemctl"
	cmd := exec.Command(systemctl, args...)
	if sudo && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", systemctl}, args...)...)
	}
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	return out
}

func collectSnapServices() []map[string]any {
	if _, err := exec.LookPath("snap"); err != nil {
		return nil
	}
	out, err := exec.Command("snap", "services", "--color=never").Output()
	if err != nil {
		return nil
	}
	lines := strings.Split(string(out), "\n")
	var rows []map[string]any
	for i, line := range lines {
		if i == 0 || strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		name := fields[0]
		if name == "Service" {
			continue
		}
		rows = append(rows, map[string]any{
			"name":    name,
			"kind":    "snap",
			"state":   fields[2],
			"enabled": strings.EqualFold(fields[2], "active"),
			"detail":  strings.Join(fields[1:], " "),
		})
		if len(rows) >= 200 {
			break
		}
	}
	return rows
}

// collectServicesLinux is the legacy collector kept as fallback.
func collectServicesLinux(sudo bool) []map[string]any {
	systemctl := "systemctl"
	args := []string{"list-units", "--type=service", "--no-pager", "--no-legend"}
	cmd := exec.Command(systemctl, args...)
	if sudo && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", systemctl}, args...)...)
	}
	out, err := cmd.Output()
	if err != nil {
		return []map[string]any{}
	}
	var rows []map[string]any
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 1 {
			continue
		}
		name := fields[0]
		state := "unknown"
		if len(fields) >= 4 {
			state = fields[3]
		}
		rows = append(rows, map[string]any{
			"name":    name,
			"kind":    "systemd",
			"state":   state,
			"enabled": strings.Contains(strings.ToLower(line), "enabled"),
		})
		if len(rows) >= 400 {
			break
		}
	}
	return rows
}

func collectServicesDarwin() []map[string]any {
	out, err := exec.Command("launchctl", "list").Output()
	if err != nil {
		return nil
	}
	var rows []map[string]any
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "PID") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		pid := fields[0]
		name := fields[2]
		state := "loaded"
		if pid == "-" {
			state = "not running"
		}
		rows = append(rows, map[string]any{
			"name":    name,
			"kind":    "launchd",
			"state":   state,
			"enabled": pid != "-",
			"detail":  "pid=" + pid,
		})
		if len(rows) >= 400 {
			break
		}
	}
	return rows
}

func parseDockerJSONLines(out []byte, runtime string) []map[string]any {
	var rows []map[string]any
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			continue
		}
		name, _ := m["Names"].(string)
		image, _ := m["Image"].(string)
		if name == "" {
			continue
		}
		rows = append(rows, map[string]any{
			"name":    name,
			"image":   image,
			"runtime": runtime,
			"status":  m["Status"],
		})
	}
	return rows
}
