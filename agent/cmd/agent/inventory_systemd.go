package main

import (
	"strings"
)

type systemdUnitRow struct {
	ID            string
	Type          string
	LoadState     string
	ActiveState   string
	SubState      string
	UnitFileState string
}

// collectSystemdServices uses systemctl show for accurate Type / Active / Sub / UnitFile.
func collectSystemdServices(sudo bool) []map[string]any {
	out := systemctlOutput(
		sudo,
		"show",
		"--type=service",
		"--property=Id,Type,ActiveState,SubState,UnitFileState,LoadState",
	)
	if out == nil || len(out) == 0 {
		return nil
	}
	units := parseSystemctlShowBlocks(string(out))
	if len(units) == 0 {
		return nil
	}

	failed := systemdFailedUnitSet(sudo)
	var rows []map[string]any
	for _, u := range units {
		if u.ID == "" || !strings.HasSuffix(u.ID, ".service") {
			continue
		}
		active := u.ActiveState
		if active == "" {
			active = "unknown"
		}
		if failed[u.ID] {
			active = "failed"
		}
		unitFile := u.UnitFileState
		enabled := unitFileEnabled(unitFile)
		detail := formatSystemdDetail(u)
		attention := systemdUnitNeedsAttention(u, enabled, failed[u.ID])

		row := map[string]any{
			"name":    u.ID,
			"kind":    "systemd",
			"state":   active,
			"enabled": enabled,
			"detail":  detail,
		}
		if attention {
			row["needsAttention"] = true
		}
		rows = append(rows, row)
		if len(rows) >= 700 {
			break
		}
	}
	return dedupeServices(rows)
}

func parseSystemctlShowBlocks(raw string) []systemdUnitRow {
	var units []systemdUnitRow
	var cur systemdUnitRow
	flush := func() {
		if cur.ID != "" {
			units = append(units, cur)
		}
		cur = systemdUnitRow{}
	}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			flush()
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch key {
		case "Id":
			if cur.ID != "" {
				flush()
			}
			cur.ID = val
		case "Type":
			cur.Type = val
		case "LoadState":
			cur.LoadState = val
		case "ActiveState":
			cur.ActiveState = val
		case "SubState":
			cur.SubState = val
		case "UnitFileState":
			cur.UnitFileState = val
		}
	}
	flush()
	return units
}

func unitFileEnabled(unitFile string) bool {
	switch strings.ToLower(unitFile) {
	case "enabled", "enabled-runtime", "linked", "linked-runtime":
		return true
	default:
		return false
	}
}

func formatSystemdDetail(u systemdUnitRow) string {
	parts := []string{}
	if u.Type != "" {
		parts = append(parts, "type="+u.Type)
	}
	if u.SubState != "" {
		parts = append(parts, "sub="+u.SubState)
	}
	if u.UnitFileState != "" {
		parts = append(parts, "file="+u.UnitFileState)
	}
	if u.LoadState != "" && u.LoadState != "loaded" {
		parts = append(parts, "load="+u.LoadState)
	}
	return strings.Join(parts, " · ")
}

// systemdUnitNeedsAttention mirrors fleet API service-health rules using unit Type.
func systemdUnitNeedsAttention(u systemdUnitRow, enabled, forcedFailed bool) bool {
	active := strings.ToLower(u.ActiveState)
	sub := strings.ToLower(u.SubState)
	unitType := strings.ToLower(u.Type)
	unitFile := strings.ToLower(u.UnitFileState)

	if forcedFailed || active == "failed" || sub == "failed" {
		return true
	}
	switch active {
	case "active", "activating", "reloading":
		return false
	case "exited":
		// Oneshot/mount units exit 0 and stay "exited" while healthy.
		return unitType != "oneshot" && unitType != "mount"
	}
	if unitFile == "masked" || unitFile == "disabled" || unitFile == "static" {
		return false
	}
	if !enabled {
		return false
	}
	// Long-running unit types expected to be active when enabled.
	switch unitType {
	case "oneshot", "mount", "idle":
		return false
	case "notify", "simple", "forking", "dbus", "exec":
		return active == "inactive" || active == "dead"
	default:
		if active == "inactive" || active == "dead" {
			return !isLikelyTransientSystemdName(u.ID)
		}
	}
	return false
}

func isLikelyTransientSystemdName(name string) bool {
	n := strings.ToLower(name)
	patterns := []string{
		"apt-", "dpkg-", "-wait-online.service", "-wait.service",
		"dispatcher.service", "autovt@", "systemd-", "@.service",
		".socket", ".mount", ".timer", "weekly.service", "daily.service",
		"fstrim", "logrotate", "man-db", "plocate", "update-notifier",
		"fwupd-", "ua-", "motd-news", "e2scrub", "grub-",
	}
	for _, p := range patterns {
		if strings.Contains(n, p) {
			return true
		}
	}
	return false
}

func systemdFailedUnitSet(sudo bool) map[string]bool {
	out := systemdFailedUnits(sudo)
	set := make(map[string]bool, len(out))
	for _, u := range out {
		set[u] = true
	}
	return set
}
