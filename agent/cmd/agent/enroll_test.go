package main

import "testing"

func TestNormalizeEnrollHostname(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"mailcow", "mailcow"},
		{"mail.example.com", "mail.example.com"},
		{"_bad", "bad"},
		{"  mail.example.com.  ", "mail.example.com"},
		{"", "fleet-host"},
	}
	for _, tc := range cases {
		got := normalizeEnrollHostname(tc.in)
		if got != tc.want {
			t.Errorf("normalizeEnrollHostname(%q) = %q, want %q", tc.in, got, tc.want)
		}
		if !enrollHostnameRe.MatchString(got) {
			t.Errorf("invalid hostname %q", got)
		}
	}
}

func TestEnrollHostnameFlagStripsDomain(t *testing.T) {
	got := enrollHostnameFlag("mail.example.com")
	if got != "mail" {
		t.Fatalf("got %q", got)
	}
}
