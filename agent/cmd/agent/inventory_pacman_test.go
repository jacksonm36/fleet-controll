package main

import "testing"

func TestParsePacmanUpgradeLine(t *testing.T) {
	name, cur, avail, ok := parsePacmanUpgradeLine("curl 8.11.1-1 -> 8.12.1-1")
	if !ok || name != "curl" || cur != "8.11.1-1" || avail != "8.12.1-1" {
		t.Fatalf("got %q %q %q ok=%v", name, cur, avail, ok)
	}
}
