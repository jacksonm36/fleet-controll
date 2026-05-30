package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type tlsPinDigest struct {
	algo   string // sha512 or sha256
	digest []byte
}

func normalizePinHex(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	s = strings.ReplaceAll(s, ":", "")
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ToLower(s)
	if len(s)%2 != 0 {
		return "", fmt.Errorf("odd hex length")
	}
	if _, err := hex.DecodeString(s); err != nil {
		return "", err
	}
	return s, nil
}

// loadTlsPin reads FLEET_TLS_PIN (preferred) or legacy FLEET_TLS_PIN_SHA256.
// Formats: sha512:<hex>, sha256:<hex>, or bare hex (64 bytes → sha512, 32 → sha256).
func loadTlsPin() *tlsPinDigest {
	raw := strings.TrimSpace(os.Getenv("FLEET_TLS_PIN"))
	if raw == "" {
		legacy := strings.TrimSpace(os.Getenv("FLEET_TLS_PIN_SHA256"))
		if legacy == "" {
			return nil
		}
		raw = "sha256:" + legacy
	}

	lower := strings.ToLower(raw)
	var algo string
	var hexPart string
	switch {
	case strings.HasPrefix(lower, "sha512:"):
		algo = "sha512"
		hexPart = raw[len("sha512:"):]
	case strings.HasPrefix(lower, "sha256:"):
		algo = "sha256"
		hexPart = raw[len("sha256:"):]
	default:
		hexPart = raw
	}

	norm, err := normalizePinHex(hexPart)
	if err != nil {
		return nil
	}
	digest, err := hex.DecodeString(norm)
	if err != nil {
		return nil
	}

	if algo == "" {
		switch len(digest) {
		case sha512.Size:
			algo = "sha512"
		case sha256.Size:
			algo = "sha256"
		default:
			return nil
		}
	}

	switch algo {
	case "sha512":
		if len(digest) != sha512.Size {
			return nil
		}
	case "sha256":
		if len(digest) != sha256.Size {
			return nil
		}
	default:
		return nil
	}

	return &tlsPinDigest{algo: algo, digest: digest}
}

func hashSPKI(algo string, spki []byte) ([]byte, bool) {
	switch algo {
	case "sha512":
		sum := sha512.Sum512(spki)
		return sum[:], true
	case "sha256":
		sum := sha256.Sum256(spki)
		return sum[:], true
	default:
		return nil, false
	}
}

func hashCertDER(algo string, der []byte) ([]byte, bool) {
	switch algo {
	case "sha512":
		sum := sha512.Sum512(der)
		return sum[:], true
	case "sha256":
		sum := sha256.Sum256(der)
		return sum[:], true
	default:
		return nil, false
	}
}

func peerMatchesPin(rawCerts [][]byte, pin *tlsPinDigest) bool {
	if pin == nil || len(rawCerts) == 0 {
		return false
	}
	cert, err := x509.ParseCertificate(rawCerts[0])
	if err != nil {
		return false
	}
	if spki, err := x509.MarshalPKIXPublicKey(cert.PublicKey); err == nil {
		if sum, ok := hashSPKI(pin.algo, spki); ok && string(sum) == string(pin.digest) {
			return true
		}
	}
	if sum, ok := hashCertDER(pin.algo, rawCerts[0]); ok {
		return string(sum) == string(pin.digest)
	}
	return false
}

func applyCertPin(cfg *tls.Config) {
	pin := loadTlsPin()
	if pin == nil {
		return
	}
	prev := cfg.VerifyPeerCertificate
	cfg.VerifyPeerCertificate = func(rawCerts [][]byte, verifiedChains [][]*x509.Certificate) error {
		if prev != nil {
			if err := prev(rawCerts, verifiedChains); err != nil {
				return err
			}
		}
		if !peerMatchesPin(rawCerts, pin) {
			return fmt.Errorf(
				"controller TLS pin mismatch (FLEET_TLS_PIN %s)",
				pin.algo,
			)
		}
		return nil
	}
}

func hasTlsPin() bool {
	return loadTlsPin() != nil
}

// loadTlsPinFromFile reads ~/.fleet/tls-pin when FLEET_TLS_PIN is unset (install scripts).
func loadTlsPinFromFile() {
	if strings.TrimSpace(os.Getenv("FLEET_TLS_PIN")) != "" {
		return
	}
	if strings.TrimSpace(os.Getenv("FLEET_TLS_PIN_SHA256")) != "" {
		return
	}
	dir := defaultFleetDir()
	if dir == "" {
		return
	}
	b, err := os.ReadFile(filepath.Join(dir, "tls-pin"))
	if err != nil || len(bytes.TrimSpace(b)) == 0 {
		return
	}
	_ = os.Setenv("FLEET_TLS_PIN", strings.TrimSpace(string(b)))
}
