package main

import (
	"os"
	"regexp"
	"strings"
)

const maxEnrollOSDetail = 512
const maxEnrollHostname = 128

var enrollHostnameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

func normalizeEnrollHostname(raw string) string {
	h := strings.TrimSpace(raw)
	h = strings.TrimSuffix(h, ".")
	if h == "" {
		h = "fleet-host"
	}
	if len(h) > maxEnrollHostname {
		h = h[:maxEnrollHostname]
	}
	if enrollHostnameRe.MatchString(h) {
		return h
	}
	var b strings.Builder
	for _, r := range h {
		switch {
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '.', r == '_', r == '-':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	cleaned := strings.Trim(b.String(), "-._")
	if cleaned == "" || !((cleaned[0] >= 'A' && cleaned[0] <= 'Z') || (cleaned[0] >= 'a' && cleaned[0] <= 'z') || (cleaned[0] >= '0' && cleaned[0] <= '9')) {
		cleaned = "fleet-host-" + cleaned
	}
	if len(cleaned) > maxEnrollHostname {
		cleaned = cleaned[:maxEnrollHostname]
	}
	if enrollHostnameRe.MatchString(cleaned) {
		return cleaned
	}
	return "fleet-host"
}

func enrollOSDetail() string {
	d := collectOSDetail()
	if len(d) > maxEnrollOSDetail {
		return d[:maxEnrollOSDetail]
	}
	return d
}

func enrollHostnameFlag(flag string) string {
	h := strings.TrimSpace(flag)
	if h == "" {
		h, _ = os.Hostname()
	}
	// Prefer short name (matches hostname -s on Linux).
	if i := strings.IndexByte(h, '.'); i > 0 {
		short := h[:i]
		if short != "" {
			h = short
		}
	}
	return normalizeEnrollHostname(h)
}
