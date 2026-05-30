package main

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestSafeFleetDataPathRejectsTraversal(t *testing.T) {
	cases := []string{
		"../etc/passwd",
		"foo/../../.upgrade.lock",
		"/etc/passwd",
		"",
		"unexpected-file",
	}
	for _, c := range cases {
		if _, err := safeFleetDataPath(c); err == nil {
			t.Fatalf("expected error for %q", c)
		}
	}
}

func TestSafeFleetDataPathAllowsUpgradeLock(t *testing.T) {
	p, err := safeFleetDataPath(".upgrade.lock")
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Clean(fleetAgentDataDir())
	if !stringsHasPrefix(p, root) {
		t.Fatalf("path %q not under %q", p, root)
	}
}

func stringsHasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

func TestReadUpgradeLockPIDRejectsGarbage(t *testing.T) {
	dir := t.TempDir()
	lock := filepath.Join(dir, ".upgrade.lock")
	if err := os.WriteFile(lock, []byte("not-a-pid\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := readUpgradeLockPID(lock); err == nil {
		t.Fatal("expected error for garbage pid")
	}
}

func TestUpgradeLockIsStaleDeadPID(t *testing.T) {
	dir := t.TempDir()
	lock := filepath.Join(dir, ".upgrade.lock")
	if err := os.WriteFile(lock, []byte("999999\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	stale, reason := upgradeLockIsStale(lock)
	if !stale {
		t.Fatalf("expected stale lock, got reason %q", reason)
	}
}

func TestUpgradeLockIsStaleOwnPIDWithoutHelper(t *testing.T) {
	dir := t.TempDir()
	lock := filepath.Join(dir, ".upgrade.lock")
	if err := os.WriteFile(lock, []byte(strconv.Itoa(os.Getpid())+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	stale, reason := upgradeLockIsStale(lock)
	if !stale {
		t.Fatalf("expected stale for own pid without helper, got %q", reason)
	}
}
