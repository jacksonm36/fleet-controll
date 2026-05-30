package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	upgradeHandoffStuckAge = 8 * time.Minute
	orphanDownloadMaxAge   = 2 * time.Hour
	selfHealIntervalSec    = 300
	maxLockFileBytes       = 32
)

var safeFleetDataBasenames = map[string]bool{
	".upgrade.lock":           true,
	"upgrade-success.marker":  true,
	"apply-binary-upgrade.sh": true,
	"upgrade.log":             true,
}

func selfHealEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("FLEET_SELF_HEAL")))
	return v == "" || v == "1" || v == "true" || v == "yes"
}

// safeFleetDataPath resolves a basename under the agent data directory (no traversal).
func safeFleetDataPath(basename string) (string, error) {
	name := strings.TrimSpace(basename)
	if name == "" || name != filepath.Base(name) || strings.Contains(name, "..") {
		return "", fmt.Errorf("invalid fleet data basename %q", basename)
	}
	if !safeFleetDataBasenames[name] && !strings.HasPrefix(name, ".fleet-agent-dl-") {
		return "", fmt.Errorf("refusing fleet data path %q", basename)
	}
	root := filepath.Clean(fleetAgentDataDir())
	full := filepath.Clean(filepath.Join(root, name))
	if !strings.HasPrefix(full, root+string(os.PathSeparator)) && full != root {
		return "", fmt.Errorf("path escapes fleet data dir")
	}
	return full, nil
}

func readUpgradeLockPID(lockPath string) (int, error) {
	f, err := os.Open(lockPath)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	buf := make([]byte, maxLockFileBytes)
	n, err := f.Read(buf)
	if err != nil && n == 0 {
		return 0, err
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(buf[:n])))
	if err != nil || pid <= 0 {
		return 0, fmt.Errorf("invalid lock pid")
	}
	return pid, nil
}

func pidAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	return syscall.Kill(pid, 0) == nil
}

func upgradeHelperProcessRunning() bool {
	if runtime.GOOS != "linux" {
		return false
	}
	needle := "apply-binary-upgrade.sh"
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return false
	}
	for _, ent := range entries {
		if !ent.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(ent.Name())
		if err != nil || pid <= 0 {
			continue
		}
		cmdline, err := os.ReadFile(filepath.Join("/proc", ent.Name(), "cmdline"))
		if err != nil {
			continue
		}
		if strings.Contains(string(cmdline), needle) {
			return true
		}
	}
	return false
}

func upgradeLockIsStale(lockPath string) (bool, string) {
	info, err := os.Stat(lockPath)
	if err != nil {
		return true, "lock missing or unreadable"
	}
	age := time.Since(info.ModTime())
	if age > upgradeLockMaxAge {
		return true, fmt.Sprintf("lock older than %s", upgradeLockMaxAge)
	}

	pid, err := readUpgradeLockPID(lockPath)
	if err != nil {
		return true, err.Error()
	}
	if !pidAlive(pid) {
		return true, fmt.Sprintf("lock pid %d not running", pid)
	}

	if upgradeHelperProcessRunning() {
		return false, ""
	}

	// Our PID on the lock without a running helper means a previous attempt was
	// abandoned (failed spawn, crashed helper, or duplicate retry). Clear immediately.
	if pid == os.Getpid() {
		return true, "orphaned upgrade lock (this process, no helper running)"
	}

	// Another live process holds the lock — only age out after the long window.
	if age > upgradeHandoffStuckAge {
		return true, fmt.Sprintf("lock held by pid %d for %s without upgrade helper", pid, age.Round(time.Second))
	}

	return false, ""
}

func healStaleUpgradeLock() (healed bool, reason string) {
	lockPath, err := safeFleetDataPath(".upgrade.lock")
	if err != nil {
		return false, err.Error()
	}
	if _, err := os.Stat(lockPath); err != nil {
		if os.IsNotExist(err) {
			return false, ""
		}
		return false, err.Error()
	}
	stale, why := upgradeLockIsStale(lockPath)
	if !stale {
		return false, ""
	}
	if err := os.Remove(lockPath); err != nil {
		return false, fmt.Sprintf("remove lock: %v", err)
	}
	return true, why
}

func healOrphanDownloadTemps() (removed int) {
	dest, err := resolveAgentBinaryDest()
	if err != nil {
		return 0
	}
	dir := filepath.Dir(dest)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	cutoff := time.Now().Add(-orphanDownloadMaxAge)
	for _, ent := range entries {
		if ent.IsDir() || !strings.HasPrefix(ent.Name(), ".fleet-agent-dl-") {
			continue
		}
		full := filepath.Join(dir, ent.Name())
		// Only touch temps in the same directory as the agent binary.
		if filepath.Clean(full) != full || filepath.Dir(full) != filepath.Clean(dir) {
			continue
		}
		info, err := ent.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		if err := os.Remove(full); err == nil {
			removed++
		}
	}
	return removed
}

type selfHealReport struct {
	LockCleared      bool
	LockReason       string
	OrphansRemoved   int
	ControllerSynced bool
}

func runAgentSelfHeal(cli *http.Client, base, token string) selfHealReport {
	var rep selfHealReport
	if !selfHealEnabled() {
		return rep
	}

	if healed, reason := healStaleUpgradeLock(); healed {
		rep.LockCleared = true
		rep.LockReason = reason
		log.Printf("self-heal: removed stale upgrade lock (%s)", reason)
		if cli != nil && strings.TrimSpace(token) != "" && strings.TrimSpace(base) != "" {
			setBinaryUpgradeState(cli, base, token, false, "")
			rep.ControllerSynced = true
			log.Printf("self-heal: cleared controller binary-upgrade error state")
		}
	}

	if n := healOrphanDownloadTemps(); n > 0 {
		rep.OrphansRemoved = n
		log.Printf("self-heal: removed %d orphan download temp file(s)", n)
	}

	if !rep.LockCleared && rep.OrphansRemoved == 0 {
		log.Printf("self-heal: ok (no stale upgrade lock or orphan files)")
	}

	return rep
}

func startSelfHealLoop(cli *http.Client, base, token string) {
	if !selfHealEnabled() {
		return
	}
	interval := durationFromEnvSec("FLEET_SELF_HEAL_INTERVAL_SEC", selfHealIntervalSec)
	go func() {
		ticker := time.NewTicker(time.Duration(interval) * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			runAgentSelfHeal(cli, base, token)
		}
	}()
}
