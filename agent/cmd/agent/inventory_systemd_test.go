package main

import "testing"

func TestParseSystemctlShowBlocks(t *testing.T) {
	raw := `Type=oneshot
Id=apparmor.service
ActiveState=active
SubState=exited
UnitFileState=enabled

Type=simple
Id=nginx.service
ActiveState=inactive
SubState=dead
UnitFileState=enabled
`
	units := parseSystemctlShowBlocks(raw)
	if len(units) != 2 {
		t.Fatalf("got %d units", len(units))
	}
	if units[0].ID != "apparmor.service" || units[0].Type != "oneshot" {
		t.Fatalf("first unit: %+v", units[0])
	}
	if units[1].ActiveState != "inactive" {
		t.Fatalf("nginx active: %s", units[1].ActiveState)
	}
}

func TestSystemdUnitNeedsAttention(t *testing.T) {
	cases := []struct {
		u        systemdUnitRow
		enabled  bool
		failed   bool
		want     bool
	}{
		{
			u: systemdUnitRow{ID: "apparmor.service", Type: "oneshot", ActiveState: "active", SubState: "exited"},
			enabled: true, want: false,
		},
		{
			u: systemdUnitRow{ID: "nginx.service", Type: "simple", ActiveState: "inactive", SubState: "dead", UnitFileState: "enabled"},
			enabled: true, want: true,
		},
		{
			u: systemdUnitRow{ID: "apt-daily.service", Type: "oneshot", ActiveState: "inactive", SubState: "dead", UnitFileState: "enabled"},
			enabled: true, want: false,
		},
		{
			u: systemdUnitRow{ID: "foo.service", Type: "simple", ActiveState: "failed", SubState: "failed"},
			enabled: true, failed: true, want: true,
		},
	}
	for _, tc := range cases {
		got := systemdUnitNeedsAttention(tc.u, tc.enabled, tc.failed)
		if got != tc.want {
			t.Errorf("%s: got %v want %v", tc.u.ID, got, tc.want)
		}
	}
}
