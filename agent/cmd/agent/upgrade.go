package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
)

type binaryUpdateOffer struct {
	Version string `json:"version"`
	BuildID string `json:"buildId"`
	SHA256  string `json:"sha256"`
	Asset   string `json:"asset"`
	URL     string `json:"url"`
	Force   bool   `json:"force"`
}

var upgradeMu sync.Mutex

func autoUpdateEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("FLEET_AUTO_UPDATE")))
	return v == "" || v == "1" || v == "true" || v == "yes"
}

func maybeApplyBinaryUpdate(cli *http.Client, base, token string, offer *binaryUpdateOffer) {
	maybeApplyBinaryUpdateInternal(cli, base, token, offer, false)
}

func maybeApplyBinaryUpdateInternal(cli *http.Client, base, token string, offer *binaryUpdateOffer, force bool) {
	if offer == nil {
		return
	}
	effectiveForce := force || offer.Force
	if !effectiveForce && !autoUpdateEnabled() {
		return
	}
	cur := agentBuildID()
	if cur != "" && cur != "dev" && strings.EqualFold(cur, offer.BuildID) {
		return
	}
	if strings.EqualFold(agentVersionString(), offer.Version+"+"+offer.BuildID) {
		return
	}
	go func() {
		if err := applyBinaryUpdate(cli, base, token, offer); err != nil {
			log.Printf("binary auto-update failed: %v", err)
		}
	}()
}

func triggerBinaryUpdateCheck(cli *http.Client, base, token string) {
	go func() {
		offer, err := fetchBinaryUpdateOffer(cli, base, token)
		if err != nil {
			log.Printf("binary update check: %v", err)
			return
		}
		// Controller-initiated push should override FLEET_AUTO_UPDATE.
		maybeApplyBinaryUpdateInternal(cli, base, token, offer, true)
	}()
}

func setBinaryUpgradeState(cli *http.Client, base, token string, inProgress bool, errMsg string) {
	var discard map[string]any
	body := map[string]any{"inProgress": inProgress}
	if strings.TrimSpace(errMsg) != "" {
		body["error"] = errMsg
	} else if !inProgress {
		body["error"] = nil
	}
	_ = postJSON(
		cli,
		joinURL(base, "/api/agent/v1/binary-update-state"),
		body,
		token,
		&discard,
	)
}

func reportBinaryDeployEvent(cli *http.Client, base, token, buildID, phase, level, message string) {
	var discard map[string]any
	_ = postJSON(
		cli,
		joinURL(base, "/api/agent/v1/binary-update-event"),
		map[string]any{
			"phase":   phase,
			"level":   level,
			"message": message,
			"buildId": buildID,
		},
		token,
		&discard,
	)
}

func useSudoForUpgrade() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("FLEET_USE_SUDO")))
	return v == "1" || v == "true" || v == "yes"
}

func resolveAgentBinaryDest() (string, error) {
	if v := strings.TrimSpace(os.Getenv("FLEET_AGENT_BIN")); v != "" {
		return v, nil
	}
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return "", err
	}
	if strings.HasSuffix(filepath.Base(exe), "fleet-agent") {
		return exe, nil
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".local", "bin", "fleet-agent"), nil
	}
	return filepath.Join(filepath.Dir(exe), "fleet-agent"), nil
}

func fetchBinaryUpdateOffer(cli *http.Client, base, token string) (*binaryUpdateOffer, error) {
	body := map[string]any{
		"version": agentVersionString(),
		"build":   agentBuildID(),
		"arch":    runtimeArchKey(),
	}
	var out struct {
		BinaryUpdate *binaryUpdateOffer `json:"binaryUpdate"`
	}
	if err := postJSON(cli, joinURL(base, "/api/agent/v1/heartbeat"), body, token, &out); err != nil {
		return nil, err
	}
	return out.BinaryUpdate, nil
}

func applyBinaryUpdate(cli *http.Client, base, token string, offer *binaryUpdateOffer) (applyErr error) {
	upgradeMu.Lock()
	defer upgradeMu.Unlock()

	cur := agentBuildID()
	if cur != "" && cur != "dev" && strings.EqualFold(cur, offer.BuildID) {
		setBinaryUpgradeState(cli, base, token, false, "")
		return nil
	}

	dest, err := resolveAgentBinaryDest()
	if err != nil {
		return err
	}
	destDir := filepath.Dir(dest)
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return err
	}

	setBinaryUpgradeState(cli, base, token, true, "")
	reportBinaryDeployEvent(cli, base, token, offer.BuildID, "download", "info",
		fmt.Sprintf("Downloading %s (build %s)", offer.Asset, offer.BuildID))
	defer func() {
		if applyErr != nil {
			setBinaryUpgradeState(cli, base, token, false, applyErr.Error())
		}
	}()

	downloadURL := offer.URL
	if !strings.HasPrefix(downloadURL, "http") {
		downloadURL = joinURL(base, downloadURL)
	}
	if err := validateBinaryDownloadURL(base, downloadURL); err != nil {
		return err
	}

	log.Printf("downloading agent binary %s (build %s) to %s", offer.Asset, offer.BuildID, dest)
	tmp, err := downloadVerifiedBinary(cli, downloadURL, offer.SHA256, destDir)
	if err != nil {
		return err
	}
	reportBinaryDeployEvent(cli, base, token, offer.BuildID, "verify", "success",
		"Download verified (sha256 OK)")

	scope := detectFleetAgentSystemdScope()
	lockPath := filepath.Join(fleetAgentDataDir(), ".upgrade.lock")
	if err := acquireUpgradeLock(lockPath); err != nil {
		return err
	}
	releaseLock := true
	defer func() {
		if releaseLock {
			_ = os.Remove(lockPath)
		}
	}()

	handedOff := false
	defer func() {
		if !handedOff {
			_ = os.Remove(tmp)
		}
	}()

	handoff := upgradeHandoff{
		DestPath:   dest,
		CentralURL: base,
		TokenFile:  defaultTokenPath(),
		BuildID:    offer.BuildID,
		Version:    offer.Version,
		Scope:      scope,
		UseSudo:    useSudoForUpgrade(),
		LockPath:   lockPath,
	}

	// Fast path: atomic replace while running, then restart via detached helper only.
	if err := installAgentBinary(tmp, dest); err == nil {
		_ = os.Remove(tmp)
		tmp = ""
		reportBinaryDeployEvent(cli, base, token, offer.BuildID, "install", "success",
			"Binary installed in place (atomic replace)")
		if scope == "none" {
			reportBinaryDeployEvent(cli, base, token, offer.BuildID, "restart", "warn",
				"Binary installed; restart fleet-agent manually to load the new build")
			setBinaryUpgradeState(cli, base, token, false, "")
			return nil
		}
		handoff.Mode = "restart"
		if err := spawnDetachedBinaryUpgrade(handoff); err != nil {
			return fmt.Errorf("spawn restart helper: %w", err)
		}
		releaseLock = false
		handedOff = true
		reportBinaryDeployEvent(cli, base, token, offer.BuildID, "restart", "info",
			fmt.Sprintf("Restarting service to load %s+%s", offer.Version, offer.BuildID))
		log.Printf("binary replaced; restart helper started (build %s)", offer.BuildID)
		return nil
	}

	reportBinaryDeployEvent(cli, base, token, offer.BuildID, "install", "info",
		"Handing off stop/install/start to detached upgrade helper")

	if scope == "none" {
		if err := installAgentBinary(tmp, dest); err != nil {
			return fmt.Errorf("install failed (no systemd): %w", err)
		}
		setBinaryUpgradeState(cli, base, token, false, "")
		return nil
	}

	handoff.Mode = "full"
	handoff.TmpPath = tmp
	if err := spawnDetachedBinaryUpgrade(handoff); err != nil {
		return fmt.Errorf("spawn upgrade helper: %w", err)
	}
	releaseLock = false
	handedOff = true

	reportBinaryDeployEvent(cli, base, token, offer.BuildID, "restart", "info",
		fmt.Sprintf("Upgrade helper started — installing %s+%s, then restarting service", offer.Version, offer.BuildID))
	log.Printf("binary upgrade handed off to helper (build %s)", offer.BuildID)
	return nil
}

func acquireUpgradeLock(lockPath string) error {
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return fmt.Errorf("upgrade already in progress (lock %s)", lockPath)
		}
		return err
	}
	_, _ = fmt.Fprintf(f, "%d\n", os.Getpid())
	_ = f.Close()
	return nil
}

func validateBinaryDownloadURL(controllerBase, downloadURL string) error {
	base, err := url.Parse(strings.TrimRight(controllerBase, "/"))
	if err != nil {
		return fmt.Errorf("invalid controller url: %w", err)
	}
	target, err := url.Parse(downloadURL)
	if err != nil {
		return fmt.Errorf("invalid download url: %w", err)
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return fmt.Errorf("unsupported download scheme %q", target.Scheme)
	}
	if !strings.EqualFold(target.Host, base.Host) {
		return fmt.Errorf("download host %q does not match controller %q", target.Host, base.Host)
	}
	name := filepath.Base(target.Path)
	if !strings.HasPrefix(name, "fleet-agent-linux-") {
		return fmt.Errorf("unexpected binary asset %q", name)
	}
	return nil
}

func installAgentBinary(tmp, dest string) error {
	useSudo := useSudoForUpgrade() && os.Geteuid() != 0

	// Same-directory rename replaces the running binary safely on Linux without stopping first.
	if err := os.Rename(tmp, dest); err == nil {
		_ = os.Chmod(dest, 0o755)
		return nil
	}

	if useSudo {
		if err := exec.Command("sudo", "-n", "install", "-m", "0755", tmp, dest).Run(); err == nil {
			return nil
		}
	}

	if err := exec.Command("install", "-m", "0755", tmp, dest).Run(); err == nil {
		return nil
	}

	return fmt.Errorf(
		"cannot install agent binary to %s (set FLEET_USE_SUDO=true and passwordless sudo if needed)",
		dest,
	)
}

type upgradeHandoff struct {
	Mode       string // full | restart
	TmpPath    string
	DestPath   string
	CentralURL string
	TokenFile  string
	BuildID    string
	Version    string
	Scope      string // system | user | system-sudo
	UseSudo    bool
	LockPath   string
}

func fleetAgentDataDir() string {
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".local", "share", "fleet-agent")
	}
	return filepath.Join(os.TempDir(), "fleet-agent")
}

func detectFleetAgentSystemdScope() string {
	if runtime.GOOS != "linux" {
		return "none"
	}
	if _, err := exec.LookPath("systemctl"); err != nil {
		return "none"
	}
	if os.Geteuid() == 0 {
		return "system"
	}
	if out, err := exec.Command("systemctl", "--user", "is-enabled", "fleet-agent.service").CombinedOutput(); err == nil {
		s := strings.TrimSpace(string(out))
		if s == "enabled" || s == "static" || s == "linked" {
			return "user"
		}
	}
	if out, err := exec.Command("systemctl", "is-enabled", "fleet-agent.service").CombinedOutput(); err == nil {
		s := strings.TrimSpace(string(out))
		if (s == "enabled" || s == "static" || s == "linked") && useSudoForUpgrade() {
			return "system-sudo"
		}
	}
	return "none"
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'"
}

func spawnDetachedBinaryUpgrade(h upgradeHandoff) error {
	dataDir := fleetAgentDataDir()
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	scriptPath := filepath.Join(dataDir, "apply-binary-upgrade.sh")
	logPath := filepath.Join(dataDir, "upgrade.log")
	script := buildUpgradeHelperScript(h)
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		return err
	}

	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}

	cmd := exec.Command("/bin/sh", scriptPath)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.Env = os.Environ()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return err
	}
	_ = logFile.Close()
	return nil
}

func buildUpgradeHelperScript(h upgradeHandoff) string {
	caFile := strings.TrimSpace(os.Getenv("FLEET_CA_FILE"))
	caSnippet := ""
	if caFile != "" {
		caSnippet = fmt.Sprintf(`if [ -f %s ]; then CURL_TLS="--cacert %s"; fi`, shellQuote(caFile), shellQuote(caFile))
	}
	mode := h.Mode
	if mode == "" {
		mode = "full"
	}
	return fmt.Sprintf(`#!/bin/sh
set -eu
# Detached fleet-agent binary upgrade (never stop the service from the agent process itself).
MODE=%s
TMP=%s
DEST=%s
CENTRAL=%s
TOKEN_FILE=%s
BUILD_ID=%s
SCOPE=%s
USE_SUDO=%s
LOCK=%s
LOG=%s

log() { echo "$(date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ) $*" >>"$LOG"; }
CURL_TLS="-k"
%s

cleanup() { rm -f "$LOCK"; }
trap cleanup EXIT

post_state() {
  in_progress="$1"
  err_msg="${2:-}"
  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi
  if [ ! -s "$TOKEN_FILE" ]; then
    return 0
  fi
  TOKEN="$(tr -d '\n\r' <"$TOKEN_FILE")"
  body="{\"inProgress\":$in_progress"
  if [ -n "$err_msg" ]; then
    esc="$(printf '%%s' "$err_msg" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    body="$body,\"error\":\"$esc\""
  elif [ "$in_progress" = "false" ]; then
    body="$body,\"error\":null"
  fi
  body="$body}"
  curl -fsS $CURL_TLS -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "$CENTRAL/api/agent/v1/binary-update-state" >/dev/null 2>&1 || true
}

post_event() {
  level="$1"
  phase="$2"
  msg="$3"
  if ! command -v curl >/dev/null 2>&1 || [ ! -s "$TOKEN_FILE" ]; then
    return 0
  fi
  TOKEN="$(tr -d '\n\r' <"$TOKEN_FILE")"
  esc="$(printf '%%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  curl -fsS $CURL_TLS -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"phase\":\"$phase\",\"level\":\"$level\",\"message\":\"$esc\",\"buildId\":\"$BUILD_ID\"}" \
    "$CENTRAL/api/agent/v1/binary-update-event" >/dev/null 2>&1 || true
}

systemctl_scope() {
  case "$SCOPE" in
  system) systemctl "$@";;
  system-sudo) sudo -n systemctl "$@";;
  user) systemctl --user "$@";;
  *) return 127;;
  esac
}

wait_active() {
  n=0
  while [ "$n" -lt 90 ]; do
    if systemctl_scope is-active --quiet fleet-agent.service 2>/dev/null; then
      return 0
    fi
    n=$((n + 1))
    sleep 1
  done
  return 1
}

fail() {
  log "upgrade failed: $*"
  post_state false "$*"
  post_event error failed "$*"
  rm -f "$TMP"
  exit 1
}

log "upgrade helper started (mode=$MODE build=$BUILD_ID scope=$SCOPE)"
sleep 1

if [ "$MODE" = "full" ]; then
  if [ -z "$TMP" ] || [ ! -f "$TMP" ]; then
    fail "missing staged binary at $TMP"
  fi
  if ! systemctl_scope stop fleet-agent.service; then
    log "warning: systemctl stop fleet-agent.service failed (continuing)"
  fi
  sleep 1
  if ! install -m 0755 "$TMP" "$DEST" 2>/dev/null; then
    if [ "$USE_SUDO" = "true" ] && [ "$(id -u)" -ne 0 ]; then
      if ! sudo -n install -m 0755 "$TMP" "$DEST"; then
        fail "install to $DEST failed (sudo)"
      fi
    else
      fail "install to $DEST failed"
    fi
  fi
  rm -f "$TMP"
  log "installed $DEST"
else
  log "binary already installed at $DEST; restarting service only"
fi

if ! systemctl_scope restart fleet-agent.service; then
  if ! systemctl_scope start fleet-agent.service; then
    fail "could not restart fleet-agent.service"
  fi
fi

if ! wait_active; then
  fail "fleet-agent.service did not become active after restart"
fi

log "fleet-agent.service active (build $BUILD_ID)"
post_state false ""
post_event success online "Service restarted after binary upgrade"
exit 0
`,
		shellQuote(mode),
		shellQuote(h.TmpPath),
		shellQuote(h.DestPath),
		shellQuote(strings.TrimRight(h.CentralURL, "/")),
		shellQuote(h.TokenFile),
		shellQuote(h.BuildID),
		shellQuote(h.Scope),
		shellQuote(fmt.Sprintf("%t", h.UseSudo)),
		shellQuote(h.LockPath),
		shellQuote(filepath.Join(fleetAgentDataDir(), "upgrade.log")),
		caSnippet,
	)
}

func downloadVerifiedBinary(cli *http.Client, url, wantSHA, destDir string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	res, err := cli.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		return "", fmt.Errorf("download http %d: %s", res.StatusCode, string(b))
	}

	if strings.TrimSpace(destDir) == "" {
		destDir = os.TempDir()
	}
	tmp, err := os.CreateTemp(destDir, ".fleet-agent-dl-*")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()

	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, h), res.Body); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return "", err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return "", err
	}
	if err := os.Chmod(tmpPath, 0o755); err != nil {
		os.Remove(tmpPath)
		return "", err
	}

	got := hex.EncodeToString(h.Sum(nil))
	want := strings.ToLower(strings.TrimSpace(wantSHA))
	if want != "" && got != want {
		os.Remove(tmpPath)
		return "", fmt.Errorf("sha256 mismatch (got %s want %s)", got[:12], want[:12])
	}
	return tmpPath, nil
}
