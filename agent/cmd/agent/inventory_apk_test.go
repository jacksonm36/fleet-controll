package main

import "testing"

func TestParseApkPackageToken(t *testing.T) {
	name, ver, ok := parseApkPackageToken("curl-8.12.1-r0")
	if !ok || name != "curl" || ver != "8.12.1-r0" {
		t.Fatalf("got %q %q ok=%v", name, ver, ok)
	}
}
