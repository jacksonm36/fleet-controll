package main

import (
	"fmt"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const patchBatchSize = 8

type patchBaseline struct {
	HealthScore    float64  `json:"healthScore"`
	HealthStatus   string   `json:"healthStatus"`
	FailedServices []string `json:"failedServices"`
	ActiveServices []string `json:"activeServices"`
}

type patchVerification struct {
	Passed         bool     `json:"passed"`
	Issues         []string `json:"issues,omitempty"`
	PreHealthScore float64  `json:"preHealthScore"`
	PostHealthScore float64 `json:"postHealthScore"`
}

type patchUpgradeResult struct {
	Manager             string             `json:"manager"`
	PackageNames        []string           `json:"packageNames"`
	UpgradedCount       int                `json:"upgradedCount"`
	Batches             int                `json:"batches"`
	RebootMayBeRequired bool               `json:"rebootMayBeRequired"`
	Verification        patchVerification  `json:"verification"`
}

func capturePatchBaseline(sudo bool) patchBaseline {
	base := patchBaseline{
		HealthScore:    100,
		HealthStatus:   "healthy",
		FailedServices: []string{},
		ActiveServices: []string{},
	}
	if runtime.GOOS != "linux" {
		return base
	}

	m := collectMetrics()
	if health, ok := m["health"].(map[string]any); ok {
		if score, ok := health["score"].(float64); ok {
			base.HealthScore = score
		} else if score, ok := health["score"].(int); ok {
			base.HealthScore = float64(score)
		}
		if status, ok := health["status"].(string); ok {
			base.HealthStatus = status
		}
	}

	base.FailedServices = systemdFailedUnits(sudo)
	base.ActiveServices = systemdActiveUnits(sudo)
	return base
}

func verifyPatchBaseline(before, after patchBaseline) patchVerification {
	v := patchVerification{
		Passed:          true,
		PreHealthScore:  before.HealthScore,
		PostHealthScore: after.HealthScore,
	}

	if after.HealthScore+15 < before.HealthScore {
		v.Passed = false
		v.Issues = append(v.Issues, fmt.Sprintf(
			"health score dropped %.0f → %.0f",
			before.HealthScore,
			after.HealthScore,
		))
	}
	if before.HealthStatus == "healthy" && after.HealthStatus == "critical" {
		v.Passed = false
		v.Issues = append(v.Issues, "host health status became critical")
	}

	beforeActive := make(map[string]struct{}, len(before.ActiveServices))
	for _, name := range before.ActiveServices {
		beforeActive[name] = struct{}{}
	}
	afterFailed := make(map[string]struct{}, len(after.FailedServices))
	for _, name := range after.FailedServices {
		afterFailed[name] = struct{}{}
	}
	for name := range beforeActive {
		if _, failed := afterFailed[name]; failed {
			v.Passed = false
			v.Issues = append(v.Issues, fmt.Sprintf("service %s is now failed", name))
		}
	}
	for _, name := range after.FailedServices {
		if _, ok := indexString(before.FailedServices, name); !ok {
			v.Passed = false
			v.Issues = append(v.Issues, fmt.Sprintf("new failed service: %s", name))
		}
	}

	return v
}

func indexString(list []string, target string) (int, bool) {
	for i, s := range list {
		if s == target {
			return i, true
		}
	}
	return -1, false
}

func systemdFailedUnits(sudo bool) []string {
	out, err := runOutput(sudo, "systemctl", "--failed", "--no-legend", "--plain")
	if err != nil {
		return nil
	}
	var units []string
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) > 0 {
			units = append(units, fields[0])
		}
	}
	return units
}

func systemdActiveUnits(sudo bool) []string {
	out, err := runOutput(sudo, "systemctl", "list-units", "--type=service", "--state=active", "--no-legend", "--plain")
	if err != nil {
		return nil
	}
	var units []string
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) > 0 && strings.HasSuffix(fields[0], ".service") {
			units = append(units, fields[0])
		}
		if len(units) >= 120 {
			break
		}
	}
	return units
}

func waitForPostPatchSettle() {
	time.Sleep(3 * time.Second)
}

func healthScoreFromMetrics() float64 {
	m := collectMetrics()
	if health, ok := m["health"].(map[string]any); ok {
		switch score := health["score"].(type) {
		case float64:
			return score
		case int:
			return float64(score)
		case string:
			if v, err := strconv.ParseFloat(score, 64); err == nil {
				return v
			}
		}
	}
	return 100
}

func listAptUpgradablePlan(sudo bool, securityOnly bool) ([]patchPlanEntry, error) {
	if _, err := exec.LookPath("apt-get"); err != nil {
		return nil, fmt.Errorf("apt-get not found")
	}
	pending := collectAptUpgradable(sudo)
	plan := pendingToPlanEntries(pending)
	if securityOnly {
		plan = filterSecurityPlan(plan, sudo)
	}
	return plan, nil
}

func listDnfUpgradablePlan(sudo bool, securityOnly bool) ([]patchPlanEntry, error) {
	pending := collectDnfUpgradable(sudo)
	plan := pendingToPlanEntries(pending)
	if securityOnly {
		filtered := plan[:0]
		for _, e := range plan {
			if e.Security {
				filtered = append(filtered, e)
			}
		}
		plan = filtered
	}
	return plan, nil
}

func listPacmanUpgradablePlan(sudo bool, _securityOnly bool) ([]patchPlanEntry, error) {
	if _, err := exec.LookPath("pacman"); err != nil {
		return nil, fmt.Errorf("pacman not found")
	}
	return pendingToPlanEntries(collectPacmanUpgradable(sudo)), nil
}

func listApkUpgradablePlan(sudo bool, _securityOnly bool) ([]patchPlanEntry, error) {
	if _, err := exec.LookPath("apk"); err != nil {
		return nil, fmt.Errorf("apk not found")
	}
	return pendingToPlanEntries(collectApkUpgradable(sudo)), nil
}

func listZypperUpgradablePlan(sudo bool, _securityOnly bool) ([]patchPlanEntry, error) {
	if _, err := exec.LookPath("zypper"); err != nil {
		return nil, fmt.Errorf("zypper not found")
	}
	return pendingToPlanEntries(collectZypperUpgradable(sudo)), nil
}

func listEmergeUpgradablePlan(sudo bool, _securityOnly bool) ([]patchPlanEntry, error) {
	if _, err := exec.LookPath("emerge"); err != nil {
		return nil, fmt.Errorf("emerge not found")
	}
	return pendingToPlanEntries(collectEmergeUpgradable(sudo)), nil
}

func listBrewUpgradablePlan(_sudo bool, _securityOnly bool) ([]patchPlanEntry, error) {
	if _, err := exec.LookPath("brew"); err != nil {
		return nil, fmt.Errorf("brew not found")
	}
	return pendingToPlanEntries(collectBrewUpgradable()), nil
}

func listPkgUpgradablePlan(sudo bool, _securityOnly bool) ([]patchPlanEntry, error) {
	if _, err := exec.LookPath("pkg"); err != nil {
		return nil, fmt.Errorf("pkg not found")
	}
	return pendingToPlanEntries(collectPkgUpgradable(sudo)), nil
}

func listUpgradablePlanForManager(sudo bool, manager string, securityOnly bool) ([]patchPlanEntry, error) {
	switch manager {
	case "dnf", "yum":
		return listDnfUpgradablePlan(sudo, securityOnly)
	case "apt", "dpkg":
		return listAptUpgradablePlan(sudo, securityOnly)
	case "pacman":
		return listPacmanUpgradablePlan(sudo, securityOnly)
	case "apk":
		return listApkUpgradablePlan(sudo, securityOnly)
	case "zypper":
		return listZypperUpgradablePlan(sudo, securityOnly)
	case "emerge":
		return listEmergeUpgradablePlan(sudo, securityOnly)
	case "brew":
		return listBrewUpgradablePlan(sudo, securityOnly)
	case "pkg":
		return listPkgUpgradablePlan(sudo, securityOnly)
	default:
		return nil, fmt.Errorf("unsupported manager %s", manager)
	}
}

func pendingToPlanEntries(pending []pendingUpdate) []patchPlanEntry {
	plan := make([]patchPlanEntry, 0, len(pending))
	for _, p := range pending {
		plan = append(plan, patchPlanEntry{
			Name:           p.name,
			CurrentVersion: p.current,
			TargetVersion:  p.available,
		})
	}
	return plan
}

func filterSecurityPlan(plan []patchPlanEntry, sudo bool) []patchPlanEntry {
	out, err := runOutput(sudo, "apt-get", "-s", "upgrade", "--with-new-pkgs")
	if err != nil {
		return plan[:0]
	}
	securityNames := make(map[string]struct{})
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "Inst ") || !strings.Contains(strings.ToLower(line), "security") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			securityNames[fields[1]] = struct{}{}
		}
	}
	filtered := plan[:0]
	for _, e := range plan {
		if _, ok := securityNames[e.Name]; ok {
			e.Security = true
			filtered = append(filtered, e)
		}
	}
	return filtered
}
