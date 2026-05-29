package main

import (
	"os"
	"path/filepath"
	"testing"
)

func readFixture(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestParseAptSimulateUpgrade(t *testing.T) {
	out := readFixture(t, "apt-simulate-upgrade.txt")
	plan := parseAptSimulateUpgrade(out)
	if len(plan) != 3 {
		t.Fatalf("expected 3 packages, got %d", len(plan))
	}
	if plan[0].Name != "bash" {
		t.Errorf("first package: %q", plan[0].Name)
	}
	if !plan[0].Security {
		t.Error("expected bash line to be security")
	}
	if plan[2].Security {
		t.Error("curl line should not be security")
	}
}

func TestParseDnfCheckUpdate(t *testing.T) {
	out := readFixture(t, "dnf-check-update.txt")
	plan := parseDnfCheckUpdate(out)
	if len(plan) < 3 {
		t.Fatalf("expected at least 3 packages, got %d", len(plan))
	}
	found := false
	for _, e := range plan {
		if e.Name == "openssl.x86_64" && e.TargetVersion != "" {
			found = true
		}
	}
	if !found {
		t.Error("openssl entry missing")
	}
}

func TestFilterPlanByNames(t *testing.T) {
	plan := []patchPlanEntry{
		{Name: "a"}, {Name: "b"}, {Name: "c"},
	}
	filtered := filterPlanByNames(plan, []string{"b", "c"})
	if len(filtered) != 2 {
		t.Fatalf("expected 2, got %d", len(filtered))
	}
}
