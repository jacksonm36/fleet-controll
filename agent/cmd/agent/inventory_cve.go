package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
)

var cveIDRe = regexp.MustCompile(`CVE-\d{4}-\d+`)

type vulnRow struct {
	cveId          string
	packageName    string
	packageVersion string
	manager        string
	severity       string
	summary        string
	fixedVersion   string
	source         string
}

func collectVulnerabilities(sudo bool) []map[string]any {
	var rows []vulnRow
	seen := make(map[string]struct{})

	add := func(r vulnRow) {
		r.cveId = strings.ToUpper(strings.TrimSpace(r.cveId))
		if !strings.HasPrefix(r.cveId, "CVE-") {
			return
		}
		key := r.cveId + "\x00" + r.packageName + "\x00" + r.manager
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		rows = append(rows, r)
		if len(rows) >= 600 {
			return
		}
	}

	switch runtime.GOOS {
	case "linux":
		for _, r := range collectTrivyVulns(sudo) {
			add(r)
			if len(rows) >= 600 {
				break
			}
		}
		for _, r := range collectDebsecanVulns() {
			add(r)
		}
		for _, r := range collectDnfSecurityVulns(sudo) {
			add(r)
		}
	case "windows":
		for _, r := range collectTrivyVulns(sudo) {
			add(r)
		}
	}

	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		m := map[string]any{
			"cveId":  r.cveId,
			"source": r.source,
		}
		if r.packageName != "" {
			m["packageName"] = r.packageName
		}
		if r.packageVersion != "" {
			m["packageVersion"] = r.packageVersion
		}
		if r.manager != "" {
			m["manager"] = r.manager
		}
		if r.severity != "" {
			m["severity"] = r.severity
		}
		if r.summary != "" {
			m["summary"] = r.summary
		}
		if r.fixedVersion != "" {
			m["fixedVersion"] = r.fixedVersion
		}
		out = append(out, m)
	}
	return out
}

func collectTrivyVulns(sudo bool) []vulnRow {
	// Full rootfs scans are slow; enable with FLEET_TRIVY_SCAN=1 on the agent host.
	if os.Getenv("FLEET_TRIVY_SCAN") != "1" {
		return nil
	}
	if _, err := exec.LookPath("trivy"); err != nil {
		return nil
	}
	args := []string{
		"rootfs",
		"--scanners", "vuln",
		"--format", "json",
		"--quiet",
		"--timeout", "3m",
		"/",
	}
	cmd := exec.Command("trivy", args...)
	if sudo && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", "trivy"}, args...)...)
	}
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	var report struct {
		Results []struct {
			Vulnerabilities []struct {
				VulnerabilityID  string `json:"VulnerabilityID"`
				PkgName          string `json:"PkgName"`
				InstalledVersion string `json:"InstalledVersion"`
				FixedVersion     string `json:"FixedVersion"`
				Severity         string `json:"Severity"`
				Title            string `json:"Title"`
				Description      string `json:"Description"`
			} `json:"Vulnerabilities"`
		} `json:"Results"`
	}
	if json.Unmarshal(out, &report) != nil {
		return nil
	}
	var rows []vulnRow
	for _, res := range report.Results {
		for _, v := range res.Vulnerabilities {
			if !strings.HasPrefix(v.VulnerabilityID, "CVE-") {
				continue
			}
			summary := v.Title
			if summary == "" {
				summary = v.Description
			}
			if len(summary) > 500 {
				summary = summary[:500]
			}
			rows = append(rows, vulnRow{
				cveId:          v.VulnerabilityID,
				packageName:    v.PkgName,
				packageVersion: v.InstalledVersion,
				manager:        "trivy",
				severity:       strings.ToUpper(v.Severity),
				summary:        summary,
				fixedVersion:   v.FixedVersion,
				source:         "trivy",
			})
			if len(rows) >= 400 {
				return rows
			}
		}
	}
	return rows
}

func debsecanUrgency(line string) string {
	lower := strings.ToLower(line)
	switch {
	case strings.Contains(lower, "critical"), strings.Contains(lower, " rc "):
		return "CRITICAL"
	case strings.Contains(lower, "high"), strings.Contains(lower, " hi "):
		return "HIGH"
	case strings.Contains(lower, "medium"), strings.Contains(lower, " md "):
		return "MEDIUM"
	case strings.Contains(lower, "low"), strings.Contains(lower, " lo "):
		return "LOW"
	default:
		fields := strings.Fields(line)
		for _, f := range fields {
			switch strings.ToLower(f) {
			case "critical", "rc":
				return "CRITICAL"
			case "high", "hi":
				return "HIGH"
			case "medium", "md":
				return "MEDIUM"
			case "low", "lo":
				return "LOW"
			}
		}
		return "UNKNOWN"
	}
}

func collectDebsecanVulns() []vulnRow {
	if _, err := exec.LookPath("debsecan"); err != nil {
		return nil
	}
	out, err := exec.Command("debsecan", "--format", "detail").Output()
	if err != nil {
		out, err = exec.Command("debsecan").Output()
		if err != nil {
			return nil
		}
	}
	var rows []vulnRow
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		cve := ""
		for _, m := range cveIDRe.FindAllString(line, -1) {
			cve = m
		}
		if cve == "" {
			continue
		}
		pkg := strings.Fields(line)[0]
		if strings.EqualFold(pkg, cve) || pkg == "" {
			pkg = ""
		}
		rows = append(rows, vulnRow{
			cveId:       cve,
			packageName: pkg,
			manager:     "dpkg",
			severity:    debsecanUrgency(line),
			source:      "debsecan",
		})
		if len(rows) >= 300 {
			break
		}
	}
	return rows
}

func collectDnfSecurityVulns(sudo bool) []vulnRow {
	bin := "dnf"
	if _, err := exec.LookPath(bin); err != nil {
		bin = "yum"
		if _, err := exec.LookPath(bin); err != nil {
			return nil
		}
	}
	args := []string{"updateinfo", "info", "--security", "-q"}
	cmd := exec.Command(bin, args...)
	if sudo && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", bin}, args...)...)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil
	}
	var rows []vulnRow
	var curPkg string
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		lower := strings.ToLower(line)
		if strings.HasPrefix(lower, "package") || strings.HasPrefix(lower, "name") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				curPkg = parts[len(parts)-1]
			}
			continue
		}
		for _, cve := range cveIDRe.FindAllString(line, -1) {
			sev := "UNKNOWN"
			if strings.Contains(lower, "critical") {
				sev = "CRITICAL"
			} else if strings.Contains(lower, "important") || strings.Contains(lower, "high") {
				sev = "HIGH"
			} else if strings.Contains(lower, "moderate") || strings.Contains(lower, "medium") {
				sev = "MEDIUM"
			} else if strings.Contains(lower, "low") {
				sev = "LOW"
			}
			rows = append(rows, vulnRow{
				cveId:       cve,
				packageName: curPkg,
				manager:     "rpm",
				severity:    sev,
				summary:     line,
				source:      "dnf",
			})
		}
		if len(rows) >= 300 {
			break
		}
	}
	return rows
}
