package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha512"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"math/big"
	"strings"
	"testing"
	"time"
)

func TestPeerMatchesPinSPKISha512(t *testing.T) {
	der := testCertDER(t)
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	spki, err := x509.MarshalPKIXPublicKey(cert.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha512.Sum512(spki)
	pin := &tlsPinDigest{algo: "sha512", digest: sum[:]}
	if !peerMatchesPin([][]byte{der}, pin) {
		t.Fatal("expected SPKI sha512 pin match")
	}
}

func TestLoadTlsPinPrefixedSha512(t *testing.T) {
	der := testCertDER(t)
	cert, _ := x509.ParseCertificate(der)
	spki, _ := x509.MarshalPKIXPublicKey(cert.PublicKey)
	sum := sha512.Sum512(spki)
	hexPin := hex.EncodeToString(sum[:])
	t.Setenv("FLEET_TLS_PIN", "sha512:"+hexPin)
	t.Setenv("FLEET_TLS_PIN_SHA256", "")
	got := loadTlsPin()
	if got == nil || got.algo != "sha512" {
		t.Fatalf("got=%v", got)
	}
}

func TestLoadTlsPinLegacySha256(t *testing.T) {
	t.Setenv("FLEET_TLS_PIN", "")
	t.Setenv("FLEET_TLS_PIN_SHA256", strings.Repeat("ab", 32))
	got := loadTlsPin()
	if got == nil || got.algo != "sha256" || len(got.digest) != 32 {
		t.Fatalf("got=%v", got)
	}
}

func testCertDER(t *testing.T) []byte {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "test"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return der
}
