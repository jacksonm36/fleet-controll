package main

import (
	"strings"
	"testing"
)

func TestSystemctlListUnitsColumnIndices(t *testing.T) {
	line := "  nginx.service    loaded    active   running  A high performance web server"
	fields := strings.Fields(strings.TrimSpace(line))
	if len(fields) < 4 {
		t.Fatalf("expected 4+ fields, got %d", len(fields))
	}
	if fields[0] != "nginx.service" {
		t.Fatalf("unit %q", fields[0])
	}
	if fields[2] != "active" {
		t.Fatalf("ACTIVE column = %q, want active", fields[2])
	}
	if fields[3] != "running" {
		t.Fatalf("SUB column = %q, want running", fields[3])
	}
}
