package main

import "testing"

func TestKernelImagesAligned(t *testing.T) {
	cases := []struct {
		running, installed string
		want               bool
	}{
		{"6.12.90+deb13.1-amd64", "6.12.90-2", true},
		{"6.12.90+deb13.1-amd64", "6.12.90+deb13.1-amd64", true},
		{"6.12.90-2", "6.12.90-2", true},
		{"6.11.0-1-amd64", "6.12.90-2", false},
		{"", "6.12.90-2", false},
		{"6.12.90+deb13.1-amd64", "", false},
	}
	for _, tc := range cases {
		got := kernelImagesAligned(tc.running, tc.installed)
		if got != tc.want {
			t.Errorf(
				"kernelImagesAligned(%q, %q) = %v, want %v",
				tc.running,
				tc.installed,
				got,
				tc.want,
			)
		}
	}
}

func TestLinuxKernelUpstreamVersion(t *testing.T) {
	if got := linuxKernelUpstreamVersion("6.12.90+deb13.1-amd64"); got != "6.12.90" {
		t.Fatalf("got %q", got)
	}
	if got := linuxKernelUpstreamVersion("6.12.90-2"); got != "6.12.90" {
		t.Fatalf("got %q", got)
	}
}
