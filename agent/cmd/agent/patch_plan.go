package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

// patchPlanEntry is one package change proposed by a dry-run.
type patchPlanEntry struct {
	Name           string `json:"name"`
	CurrentVersion string `json:"currentVersion"`
	TargetVersion  string `json:"targetVersion"`
	Security       bool   `json:"security"`
}

type patchPlanResult struct {
	Plan                []patchPlanEntry `json:"plan"`
	Manager             string           `json:"manager"`
	RebootMayBeRequired bool             `json:"rebootMayBeRequired"`
	PlanSource          string           `json:"planSource,omitempty"`
}

type patchUpgradeOpts struct {
	manager      string
	packageNames []string
	securityOnly bool
	all          bool
	pinVersions  map[string]string // optional name -> exact apt version (e.g. from CVE plan)
}

func parsePatchPayload(payload json.RawMessage) patchUpgradeOpts {
	opts := patchUpgradeOpts{
		manager: "apt",
	}
	if len(payload) == 0 {
		return opts
	}
	var p map[string]any
	if err := json.Unmarshal(payload, &p); err != nil {
		return opts
	}
	if v, ok := p["manager"].(string); ok && v != "" {
		opts.manager = v
	}
	if v, ok := p["securityOnly"].(bool); ok {
		opts.securityOnly = v
	}
	if v, ok := p["all"].(bool); ok {
		opts.all = v
	}
	if raw, ok := p["packageNames"].([]any); ok {
		for _, item := range raw {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				opts.packageNames = append(opts.packageNames, strings.TrimSpace(s))
			}
		}
	}
	var namesFromPackages []string
	if raw, ok := p["packages"].([]any); ok {
		for _, item := range raw {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			name, _ := m["name"].(string)
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			namesFromPackages = append(namesFromPackages, name)
			tv, _ := m["targetVersion"].(string)
			tv = strings.TrimSpace(tv)
			if tv != "" {
				if opts.pinVersions == nil {
					opts.pinVersions = make(map[string]string)
				}
				opts.pinVersions[name] = tv
			}
		}
	}
	if len(opts.packageNames) == 0 && len(namesFromPackages) > 0 {
		opts.packageNames = namesFromPackages
	}
	return opts
}

func runPackagePatchPlan(payload json.RawMessage, sudo bool, logFn func(string)) (patchPlanResult, error) {
	opts := parsePatchPayload(payload)
	applyDefaultPatchManager(&opts)
	logFn(fmt.Sprintf("dry-run patch plan manager=%s securityOnly=%v", opts.manager, opts.securityOnly))

	var plan []patchPlanEntry
	var err error
	switch runtime.GOOS {
	case "linux":
		switch opts.manager {
		case "dnf", "yum":
			plan, err = dryRunDnfPlan(sudo, opts)
		case "apt", "dpkg":
			plan, err = dryRunAptPlan(sudo, opts)
		case "pacman":
			plan, err = listPacmanUpgradablePlan(sudo, opts.securityOnly)
		case "apk":
			plan, err = listApkUpgradablePlan(sudo, opts.securityOnly)
		case "zypper":
			plan, err = listZypperUpgradablePlan(sudo, opts.securityOnly)
		case "emerge":
			plan, err = listEmergeUpgradablePlan(sudo, opts.securityOnly)
		default:
			return patchPlanResult{}, fmt.Errorf("unsupported manager %s", opts.manager)
		}
	case "darwin":
		if opts.manager != "brew" {
			return patchPlanResult{}, fmt.Errorf("unsupported darwin manager %s", opts.manager)
		}
		plan, err = listBrewUpgradablePlan(sudo, opts.securityOnly)
	case "freebsd", "openbsd", "netbsd":
		if opts.manager != "pkg" {
			return patchPlanResult{}, fmt.Errorf("unsupported bsd manager %s", opts.manager)
		}
		plan, err = listPkgUpgradablePlan(sudo, opts.securityOnly)
	case "windows":
		return patchPlanResult{}, fmt.Errorf("patch plan not supported on windows (use winget separately)")
	default:
		return patchPlanResult{}, fmt.Errorf("patch plan not supported on %s", runtime.GOOS)
	}
	planSource := "simulate"
	if err != nil {
		return patchPlanResult{}, err
	}
	if len(plan) == 0 {
		switch opts.manager {
		case "dnf", "yum":
			if fallback, fbErr := listDnfUpgradablePlan(sudo, opts.securityOnly); fbErr == nil && len(fallback) > 0 {
				plan = fallback
				planSource = "upgradable"
				logFn("dry-run returned 0 packages; using dnf check-update fallback")
			}
		case "pacman":
			if fallback, fbErr := listPacmanUpgradablePlan(sudo, opts.securityOnly); fbErr == nil && len(fallback) > 0 {
				plan = fallback
				planSource = "upgradable"
				logFn("dry-run returned 0 packages; using pacman -Qu fallback")
			}
		case "apk", "zypper", "emerge", "brew", "pkg":
			if fallback, fbErr := listUpgradablePlanForManager(sudo, opts.manager, opts.securityOnly); fbErr == nil && len(fallback) > 0 {
				plan = fallback
				planSource = "upgradable"
				logFn("dry-run returned 0 packages; using " + opts.manager + " upgradable fallback")
			}
		default:
			if fallback, fbErr := listAptUpgradablePlan(sudo, opts.securityOnly); fbErr == nil && len(fallback) > 0 {
				plan = fallback
				planSource = "upgradable"
				logFn("simulate returned 0 packages; using apt list --upgradable fallback")
			}
		}
	}

	for _, e := range plan {
		sec := ""
		if e.Security {
			sec = " [security]"
		}
		logFn(fmt.Sprintf("  %s %s -> %s%s", e.Name, e.CurrentVersion, e.TargetVersion, sec))
	}
	logFn(fmt.Sprintf("plan: %d package(s) would change", len(plan)))

	reboot := hostRebootRequired()
	return patchPlanResult{
		Plan:                plan,
		Manager:             opts.manager,
		RebootMayBeRequired: reboot,
		PlanSource:          planSource,
	}, nil
}

func dryRunAptPlan(sudo bool, opts patchUpgradeOpts) ([]patchPlanEntry, error) {
	if err := runQuiet(sudo, "apt-get", "update", "-qq"); err != nil {
		return nil, fmt.Errorf("apt-get update: %w", err)
	}
	args := []string{"-s", "upgrade", "--with-new-pkgs"}
	if opts.securityOnly {
		// Simulate security-related upgrades via unattended-upgrade dry path when available.
		if _, err := exec.LookPath("unattended-upgrade"); err == nil {
			out, err := runOutput(sudo, "unattended-upgrade", "--dry-run", "-d")
			if err == nil && strings.TrimSpace(out) != "" {
				return parseUnattendedDryRun(out), nil
			}
		}
	}
	out, err := runOutput(sudo, "apt-get", args...)
	if err != nil {
		return nil, err
	}
	plan := parseAptSimulateUpgrade(out)
	if opts.securityOnly {
		filtered := plan[:0]
		for _, e := range plan {
			if e.Security {
				filtered = append(filtered, e)
			}
		}
		plan = filtered
	}
	if len(opts.packageNames) > 0 {
		plan = filterPlanByNames(plan, opts.packageNames)
	}
	return plan, nil
}

func dryRunDnfPlan(sudo bool, opts patchUpgradeOpts) ([]patchPlanEntry, error) {
	bin := "dnf"
	if _, err := exec.LookPath(bin); err != nil {
		bin = "yum"
	}
	var plan []patchPlanEntry
	if opts.securityOnly {
		out, err := runOutput(sudo, bin, "upgrade", "--security", "-y", "--assumeno")
		if err != nil {
			// Some versions exit non-zero when updates exist; still parse output.
			if out == "" {
				return nil, err
			}
		}
		plan = parseDnfUpgradeOutput(out)
	} else if len(opts.packageNames) > 0 {
		args := append([]string{"upgrade", "-y", "--assumeno"}, opts.packageNames...)
		out, err := runOutput(sudo, bin, args...)
		if err != nil && out == "" {
			return nil, err
		}
		plan = parseDnfUpgradeOutput(out)
	} else {
		out, err := runOutput(sudo, bin, "check-update", "--quiet")
		if err != nil {
			// dnf check-update exits 100 when updates available
			if out == "" {
				return nil, err
			}
		}
		plan = parseDnfCheckUpdate(out)
	}
	if len(plan) == 0 {
		if fallback, fbErr := listDnfUpgradablePlan(sudo, opts.securityOnly); fbErr == nil {
			plan = fallback
		}
	}
	return plan, nil
}

func parseAptSimulateUpgrade(output string) []patchPlanEntry {
	var plan []patchPlanEntry
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "Inst ") {
			continue
		}
		e := parseAptInstLine(line)
		if e.Name != "" {
			plan = append(plan, e)
		}
	}
	return plan
}

func parseAptInstLine(line string) patchPlanEntry {
	// Inst pkg [current] (target ...)
	fields := strings.Fields(line)
	if len(fields) < 4 {
		return patchPlanEntry{}
	}
	name := fields[1]
	current := ""
	target := ""
	for i, f := range fields {
		if strings.HasPrefix(f, "[") {
			current = strings.Trim(f, "[]")
			if strings.HasSuffix(current, "]") == false && i+1 < len(fields) {
				// multi-token version in brackets — rare
			}
		}
		if strings.HasPrefix(f, "(") {
			target = strings.TrimPrefix(f, "(")
			target = strings.TrimSuffix(target, ")")
			break
		}
	}
	security := strings.Contains(strings.ToLower(line), "security")
	return patchPlanEntry{
		Name:           name,
		CurrentVersion: current,
		TargetVersion:  target,
		Security:       security,
	}
}

func parseUnattendedDryRun(output string) []patchPlanEntry {
	var plan []patchPlanEntry
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		lower := strings.ToLower(line)
		if !strings.Contains(lower, "packages that will be upgraded") &&
			!strings.HasPrefix(lower, "inst ") {
			continue
		}
		if strings.HasPrefix(line, "Inst ") {
			e := parseAptInstLine(line)
			e.Security = true
			if e.Name != "" {
				plan = append(plan, e)
			}
		}
	}
	return plan
}

func parseDnfCheckUpdate(output string) []patchPlanEntry {
	var plan []patchPlanEntry
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Last metadata") ||
			strings.HasPrefix(line, "Security:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := fields[0]
		if name == "" || strings.HasSuffix(name, ".") {
			continue
		}
		avail := fields[1]
		if strings.HasSuffix(avail, ".") {
			avail = strings.TrimSuffix(avail, ".")
		}
		security := strings.Contains(strings.ToLower(line), "security")
		plan = append(plan, patchPlanEntry{
			Name:           name,
			CurrentVersion: "",
			TargetVersion:  avail,
			Security:       security,
		})
	}
	return plan
}

func parseDnfUpgradeOutput(output string) []patchPlanEntry {
	var plan []patchPlanEntry
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		lower := strings.ToLower(line)
		if strings.HasPrefix(lower, "upgrading:") || strings.HasPrefix(lower, "installing:") {
			rest := strings.TrimSpace(line[strings.Index(line, ":")+1:])
			fields := strings.Fields(rest)
			if len(fields) >= 1 {
				name := fields[0]
				target := ""
				if len(fields) >= 2 {
					target = fields[1]
				}
				security := strings.Contains(lower, "security")
				plan = append(plan, patchPlanEntry{
					Name:          name,
					TargetVersion: target,
					Security:      security,
				})
			}
		}
	}
	if len(plan) == 0 {
		return parseDnfCheckUpdate(output)
	}
	return plan
}

func filterPlanByNames(plan []patchPlanEntry, names []string) []patchPlanEntry {
	want := make(map[string]struct{}, len(names))
	for _, n := range names {
		want[strings.TrimSpace(n)] = struct{}{}
	}
	var out []patchPlanEntry
	for _, e := range plan {
		if _, ok := want[e.Name]; ok {
			out = append(out, e)
		}
	}
	return out
}

func runPackageUpgradeWithRefresh(cli *http.Client, base, token string, payload json.RawMessage, sudo bool, logFn func(string)) (patchUpgradeResult, error) {
	result, err := runPackageUpgradeSafe(payload, sudo, logFn)
	if err != nil {
		return result, err
	}
	logFn("Refreshing inventory after upgrade…")
	inv, err := collectInventory(sudo)
	if err != nil {
		return result, err
	}
	var discard map[string]any
	if err := postJSON(cli, joinURL(base, "/api/agent/v1/inventory"), inv, token, &discard); err != nil {
		return result, err
	}
	return result, nil
}

func runPackageUpgradeSafe(payload json.RawMessage, sudo bool, logFn func(string)) (patchUpgradeResult, error) {
	opts := parsePatchPayload(payload)
	applyDefaultPatchManager(&opts)

	names := opts.packageNames
	if len(names) == 0 && (opts.all || opts.securityOnly) {
		var plan []patchPlanEntry
		var err error
		plan, err = listUpgradablePlanForManager(sudo, opts.manager, opts.securityOnly)
		if err != nil {
			return patchUpgradeResult{}, err
		}
		for _, entry := range plan {
			names = append(names, entry.Name)
		}
	}
	if len(names) == 0 {
		return patchUpgradeResult{}, fmt.Errorf("no packages selected for upgrade")
	}

	if opts.manager == "apt" || opts.manager == "dpkg" {
		opts.pinVersions = reconcileAptPinVersions(sudo, names, opts.pinVersions, logFn)
	}

	logFn(fmt.Sprintf("pre-patch health score: %.0f", healthScoreFromMetrics()))
	initialBaseline := capturePatchBaseline(sudo)
	baseline := initialBaseline

	result := patchUpgradeResult{
		Manager:      opts.manager,
		PackageNames: names,
	}

	batches := batchStrings(names, patchBatchSize)
	result.Batches = len(batches)
	for i, batch := range batches {
		logFn(fmt.Sprintf("patch batch %d/%d (%d packages)", i+1, len(batches), len(batch)))
		batchOpts := opts
		batchOpts.packageNames = batch
		batchOpts.all = false
		// Approved plans always install explicit packages; securityOnly is for discovery only.
		batchOpts.securityOnly = false
		batchPayload, err := json.Marshal(map[string]any{
			"manager":      batchOpts.manager,
			"securityOnly": batchOpts.securityOnly,
			"packageNames": batch,
			"packages":     pinsForBatch(batch, opts.pinVersions),
		})
		if err != nil {
			return result, err
		}
		upgraded, err := runPackageUpgrade(batchPayload, sudo, logFn)
		if err != nil {
			return result, err
		}
		result.UpgradedCount += upgraded
		waitForPostPatchSettle()
		after := capturePatchBaseline(sudo)
		verification := verifyPatchBaseline(baseline, after)
		if !verification.Passed {
			for _, issue := range verification.Issues {
				logFn("verification issue: " + issue)
			}
			result.Verification = verification
			result.RebootMayBeRequired = hostRebootRequired()
			return result, fmt.Errorf("post-patch verification failed: %s", strings.Join(verification.Issues, "; "))
		}
		baseline = after
	}

	final := capturePatchBaseline(sudo)
	result.Verification = verifyPatchBaseline(initialBaseline, final)
	result.RebootMayBeRequired = hostRebootRequired()
	if result.UpgradedCount == 0 {
		return result, fmt.Errorf("no packages were upgraded (requested %d)", len(names))
	}
	if !result.Verification.Passed {
		for _, issue := range result.Verification.Issues {
			logFn("final verification issue: " + issue)
		}
		return result, fmt.Errorf(
			"final post-patch verification failed: %s",
			strings.Join(result.Verification.Issues, "; "),
		)
	}
	logFn(fmt.Sprintf("post-patch health score: %.0f (verification passed)", final.HealthScore))
	logFn(fmt.Sprintf("upgraded %d package(s) across %d batch(es)", result.UpgradedCount, result.Batches))
	return result, nil
}

func batchStrings(items []string, size int) [][]string {
	if size <= 0 {
		size = 8
	}
	var batches [][]string
	for i := 0; i < len(items); i += size {
		end := i + size
		if end > len(items) {
			end = len(items)
		}
		batches = append(batches, items[i:end])
	}
	return batches
}

func pinsForBatch(names []string, pins map[string]string) []map[string]any {
	if len(pins) == 0 {
		return nil
	}
	var out []map[string]any
	for _, name := range names {
		if v := pins[name]; v != "" {
			out = append(out, map[string]any{"name": name, "targetVersion": v})
		}
	}
	return out
}

func runPackageUpgrade(payload json.RawMessage, sudo bool, logFn func(string)) (int, error) {
	opts := parsePatchPayload(payload)
	applyDefaultPatchManager(&opts)

	logFn(fmt.Sprintf("package upgrade manager=%s all=%v securityOnly=%v packages=%d",
		opts.manager, opts.all, opts.securityOnly, len(opts.packageNames)))

	switch runtime.GOOS {
	case "linux":
		switch opts.manager {
		case "dnf", "yum":
			return upgradeDnf(sudo, opts, logFn)
		case "apt", "dpkg":
			return upgradeApt(sudo, opts, logFn)
		case "pacman":
			return upgradePacman(sudo, opts, logFn)
		case "apk":
			return upgradeApk(sudo, opts, logFn)
		case "zypper":
			return upgradeZypper(sudo, opts, logFn)
		case "emerge":
			return upgradeEmerge(sudo, opts, logFn)
		default:
			return upgradeApt(sudo, opts, logFn)
		}
	case "darwin":
		if opts.manager == "brew" {
			return upgradeBrew(sudo, opts, logFn)
		}
		return 0, fmt.Errorf("unsupported darwin manager %s", opts.manager)
	case "freebsd", "openbsd", "netbsd":
		if opts.manager == "pkg" {
			return upgradePkg(sudo, opts, logFn)
		}
		return 0, fmt.Errorf("unsupported bsd manager %s", opts.manager)
	case "windows":
		if opts.manager != "winget" {
			return 0, fmt.Errorf("unsupported windows manager %s", opts.manager)
		}
		args := []string{
			"upgrade",
			"--all",
			"--accept-package-agreements",
			"--accept-source-agreements",
			"--disable-interactivity",
		}
		err := streamCommand(logFn, false, "winget", args)
		if err != nil {
			return 0, err
		}
		return len(opts.packageNames), nil
	default:
		return 0, fmt.Errorf("unsupported GOOS %s", runtime.GOOS)
	}
}

func upgradeApt(sudo bool, opts patchUpgradeOpts, logFn func(string)) (int, error) {
	if err := streamCommand(logFn, sudo, "apt-get", []string{"update"}); err != nil {
		return 0, err
	}
	if len(opts.packageNames) > 0 {
		hasPins := len(opts.pinVersions) > 0
		args := aptInstallArgs(opts.packageNames, opts.pinVersions, hasPins)
		out, err := streamCommandCapture(logFn, sudo, "apt-get", args)
		if err != nil && hasPins && aptOutputNeedsUnpinnedRetry(out) {
			logFn("pinned versions unavailable in apt; retrying without version pins")
			args = aptInstallArgs(opts.packageNames, opts.pinVersions, false)
			out, err = streamCommandCapture(logFn, sudo, "apt-get", args)
		}
		if err != nil {
			return 0, err
		}
		upgraded, installed := parseAptChangeSummary(out)
		if upgraded == 0 && installed == 0 {
			return 0, nil
		}
		return upgraded + installed, nil
	}
	if opts.securityOnly {
		if _, err := exec.LookPath("unattended-upgrade"); err == nil {
			out, err := streamCommandCapture(logFn, sudo, "unattended-upgrade", nil)
			if err != nil {
				return 0, err
			}
			return parseAptChangeSummaryCount(out), nil
		}
		logFn("unattended-upgrade not found; using apt-get upgrade (security filtering best-effort)")
		out, err := streamCommandCapture(logFn, sudo, "apt-get", []string{"upgrade", "-y"})
		if err != nil {
			return 0, err
		}
		return parseAptChangeSummaryCount(out), nil
	}
	if opts.all || len(opts.packageNames) == 0 {
		out, err := streamCommandCapture(logFn, sudo, "apt-get", []string{"upgrade", "-y"})
		if err != nil {
			return 0, err
		}
		return parseAptChangeSummaryCount(out), nil
	}
	return 0, nil
}

func upgradeDnf(sudo bool, opts patchUpgradeOpts, logFn func(string)) (int, error) {
	bin := "dnf"
	if _, err := exec.LookPath(bin); err != nil {
		bin = "yum"
	}
	if len(opts.packageNames) > 0 {
		args := append([]string{"upgrade", "-y", "--nobest"}, opts.packageNames...)
		out, err := streamCommandCapture(logFn, sudo, bin, args)
		if err != nil {
			return 0, err
		}
		return parseDnfUpgradeCount(out, len(opts.packageNames)), nil
	}
	if opts.securityOnly {
		out, err := streamCommandCapture(logFn, sudo, bin, []string{"upgrade", "--security", "-y", "--nobest"})
		if err != nil {
			return 0, err
		}
		return parseDnfUpgradeCount(out, 0), nil
	}
	out, err := streamCommandCapture(logFn, sudo, bin, []string{"upgrade", "-y", "--nobest"})
	if err != nil {
		return 0, err
	}
	return parseDnfUpgradeCount(out, 0), nil
}

func upgradePacman(sudo bool, opts patchUpgradeOpts, logFn func(string)) (int, error) {
	if _, err := exec.LookPath("pacman"); err != nil {
		return 0, fmt.Errorf("pacman not found")
	}
	if err := streamCommand(logFn, sudo, "pacman", []string{"-Sy"}); err != nil {
		return 0, err
	}
	if len(opts.packageNames) > 0 {
		args := append([]string{"-S", "--noconfirm"}, opts.packageNames...)
		if err := streamCommand(logFn, sudo, "pacman", args); err != nil {
			return 0, err
		}
		return len(opts.packageNames), nil
	}
	if opts.all {
		if err := streamCommand(logFn, sudo, "pacman", []string{"-Syu", "--noconfirm"}); err != nil {
			return 0, err
		}
		return 1, nil
	}
	return 0, nil
}

func upgradeApk(sudo bool, opts patchUpgradeOpts, logFn func(string)) (int, error) {
	if _, err := exec.LookPath("apk"); err != nil {
		return 0, fmt.Errorf("apk not found")
	}
	if err := streamCommand(logFn, sudo, "apk", []string{"update", "--quiet"}); err != nil {
		return 0, err
	}
	if len(opts.packageNames) > 0 {
		args := append([]string{"add", "--upgrade", "--no-cache"}, opts.packageNames...)
		if err := streamCommand(logFn, sudo, "apk", args); err != nil {
			return 0, err
		}
		return len(opts.packageNames), nil
	}
	if opts.all {
		if err := streamCommand(logFn, sudo, "apk", []string{"upgrade", "--no-cache"}); err != nil {
			return 0, err
		}
		return 1, nil
	}
	return 0, nil
}

func upgradeZypper(sudo bool, opts patchUpgradeOpts, logFn func(string)) (int, error) {
	if _, err := exec.LookPath("zypper"); err != nil {
		return 0, fmt.Errorf("zypper not found")
	}
	if len(opts.packageNames) > 0 {
		args := append([]string{"up", "-y"}, opts.packageNames...)
		if err := streamCommand(logFn, sudo, "zypper", args); err != nil {
			return 0, err
		}
		return len(opts.packageNames), nil
	}
	if opts.securityOnly {
		if err := streamCommand(logFn, sudo, "zypper", []string{"patch", "-y"}); err != nil {
			return 0, err
		}
		return 1, nil
	}
	if opts.all {
		if err := streamCommand(logFn, sudo, "zypper", []string{"up", "-y"}); err != nil {
			return 0, err
		}
		return 1, nil
	}
	return 0, nil
}

func upgradeEmerge(sudo bool, opts patchUpgradeOpts, logFn func(string)) (int, error) {
	if _, err := exec.LookPath("emerge"); err != nil {
		return 0, fmt.Errorf("emerge not found")
	}
	if len(opts.packageNames) > 0 {
		args := append([]string{"-v", "--update"}, opts.packageNames...)
		if err := streamCommand(logFn, sudo, "emerge", args); err != nil {
			return 0, err
		}
		return len(opts.packageNames), nil
	}
	if opts.all {
		if err := streamCommand(logFn, sudo, "emerge", []string{"-v", "--update", "--deep", "@world"}); err != nil {
			return 0, err
		}
		return 1, nil
	}
	return 0, nil
}

func upgradeBrew(_sudo bool, opts patchUpgradeOpts, logFn func(string)) (int, error) {
	if _, err := exec.LookPath("brew"); err != nil {
		return 0, fmt.Errorf("brew not found")
	}
	if len(opts.packageNames) > 0 {
		args := append([]string{"upgrade"}, opts.packageNames...)
		if err := streamCommand(logFn, false, "brew", args); err != nil {
			return 0, err
		}
		return len(opts.packageNames), nil
	}
	if opts.all {
		if err := streamCommand(logFn, false, "brew", []string{"upgrade"}); err != nil {
			return 0, err
		}
		return 1, nil
	}
	return 0, nil
}

func upgradePkg(sudo bool, opts patchUpgradeOpts, logFn func(string)) (int, error) {
	if _, err := exec.LookPath("pkg"); err != nil {
		return 0, fmt.Errorf("pkg not found")
	}
	if len(opts.packageNames) > 0 {
		args := append([]string{"upgrade", "-y"}, opts.packageNames...)
		if err := streamCommand(logFn, sudo, "pkg", args); err != nil {
			return 0, err
		}
		return len(opts.packageNames), nil
	}
	if opts.all {
		if err := streamCommand(logFn, sudo, "pkg", []string{"upgrade", "-y"}); err != nil {
			return 0, err
		}
		return 1, nil
	}
	return 0, nil
}

func reconcileAptPinVersions(
	sudo bool,
	names []string,
	pins map[string]string,
	logFn func(string),
) map[string]string {
	upgradable := collectAptUpgradable(sudo)
	avail := make(map[string]string, len(upgradable))
	for _, row := range upgradable {
		avail[row.name] = row.available
	}
	out := make(map[string]string)
	for _, name := range names {
		if actual, ok := avail[name]; ok && strings.TrimSpace(actual) != "" {
			if pin := pins[name]; pin != "" && pin != actual {
				logFn(fmt.Sprintf("using apt version for %s: %s (plan had %s)", name, actual, pin))
			}
			out[name] = actual
			continue
		}
		if pin := pins[name]; pin != "" {
			logFn(fmt.Sprintf("dropping unavailable pin for %s=%s; will install latest from apt", name, pin))
		}
	}
	return out
}

func aptInstallArgs(names []string, pins map[string]string, usePins bool) []string {
	args := []string{"install", "-y"}
	for _, name := range names {
		if usePins {
			if v := pins[name]; v != "" {
				args = append(args, name+"="+v)
				continue
			}
		}
		args = append(args, name)
	}
	return args
}

func aptOutputNeedsUnpinnedRetry(output string) bool {
	lower := strings.ToLower(output)
	return strings.Contains(lower, "was not found") ||
		strings.Contains(lower, "has no installation candidate") ||
		strings.Contains(lower, "unable to locate package")
}

func parseAptChangeSummary(output string) (upgraded, installed int) {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if !strings.Contains(line, "upgraded") || !strings.Contains(line, "newly installed") {
			continue
		}
		return parseAptSummaryFields(line)
	}
	return 0, 0
}

func parseAptChangeSummaryCount(output string) int {
	upgraded, installed := parseAptChangeSummary(output)
	return upgraded + installed
}

func parseAptSummaryFields(line string) (upgraded, installed int) {
	fields := strings.Fields(line)
	for i, f := range fields {
		switch f {
		case "upgraded,":
			if i > 0 {
				upgraded = atoiDefault(fields[i-1])
			}
		case "installed,":
			if i > 0 {
				installed = atoiDefault(fields[i-1])
			}
		}
	}
	return upgraded, installed
}

func parseDnfUpgradeCount(output string, fallback int) int {
	count := 0
	for _, line := range strings.Split(output, "\n") {
		lower := strings.ToLower(strings.TrimSpace(line))
		if strings.HasPrefix(lower, "upgraded:") || strings.HasPrefix(lower, "installed:") {
			count++
		}
	}
	if count > 0 {
		return count
	}
	return fallback
}

func atoiDefault(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return n
}

func hostRebootRequired() bool {
	if _, err := os.Stat("/var/run/reboot-required"); err == nil {
		return true
	}
	return false
}

func runQuiet(sudo bool, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	if sudo && runtime.GOOS == "linux" && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", name}, args...)...)
	}
	return cmd.Run()
}

func runOutput(sudo bool, name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	cmd.Env = append(os.Environ(), "LANG=C")
	if sudo && runtime.GOOS == "linux" && os.Geteuid() != 0 {
		cmd = exec.Command("sudo", append([]string{"-n", name}, args...)...)
		cmd.Env = append(os.Environ(), "LANG=C")
	}
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func completeJobWithResult(cli *http.Client, base, token, jobID, status, msg string, result any) error {
	body := map[string]any{"status": status}
	if msg != "" {
		body["errorMessage"] = msg
	}
	if result != nil {
		body["result"] = result
	}
	var discard map[string]any
	return postJSON(
		cli,
		joinURL(base, fmt.Sprintf("/api/agent/v1/jobs/%s/complete", jobID)),
		body,
		token,
		&discard,
	)
}
