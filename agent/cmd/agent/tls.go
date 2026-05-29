package main

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

func allowInsecureHTTP() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("FLEET_ALLOW_INSECURE_HTTP")))
	return v == "1" || v == "true" || v == "yes"
}

func insecureTLSVerify() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("FLEET_INSECURE_TLS")))
	return v == "1" || v == "true" || v == "yes"
}

func tlsRequired() bool {
	if allowInsecureHTTP() {
		return false
	}
	v := strings.ToLower(strings.TrimSpace(os.Getenv("FLEET_TLS_REQUIRED")))
	if v == "0" || v == "false" || v == "no" {
		return false
	}
	return true
}

func validateCentralURL(base string) error {
	b := strings.TrimSpace(base)
	if b == "" {
		return fmt.Errorf("central URL is empty")
	}
	lower := strings.ToLower(b)
	if strings.HasPrefix(lower, "https://") {
		return nil
	}
	if strings.HasPrefix(lower, "http://") {
		if tlsRequired() {
			return fmt.Errorf(
				"controller URL must use https:// (install via https:// controller script or set FLEET_ALLOW_INSECURE_HTTP=1 for lab only)",
			)
		}
		log.Printf(
			"warning: agent ↔ controller traffic is not encrypted (http://)",
		)
		return nil
	}
	return fmt.Errorf("controller URL must start with https:// (or http:// only when FLEET_ALLOW_INSECURE_HTTP=1)")
}

func defaultCAPath() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, ".fleet", "ca.crt")
}

// ensureControllerCA downloads the controller PEM when using HTTPS with a self-signed cert.
func ensureControllerCA(base string) {
	if p := strings.TrimSpace(os.Getenv("FLEET_CA_FILE")); p != "" {
		if _, err := os.Stat(p); err == nil {
			return
		}
	}
	lower := strings.ToLower(strings.TrimSpace(base))
	if !strings.HasPrefix(lower, "https://") {
		return
	}
	caPath := defaultCAPath()
	if caPath == "" {
		return
	}
	if _, err := os.Stat(caPath); err == nil {
		_ = os.Setenv("FLEET_CA_FILE", caPath)
		return
	}
	url := strings.TrimRight(base, "/") + "/api/public/tls-ca.crt"
	if err := os.MkdirAll(filepath.Dir(caPath), 0o755); err != nil {
		log.Printf("warning: create CA dir: %v", err)
		return
	}
	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // bootstrap only
		},
	}
	resp, err := client.Get(url)
	if err != nil {
		log.Printf("warning: download controller CA: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		log.Printf("warning: download controller CA: HTTP %d", resp.StatusCode)
		return
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil || len(body) == 0 {
		log.Printf("warning: read controller CA: %v", err)
		return
	}
	if err := os.WriteFile(caPath, body, 0o644); err != nil {
		log.Printf("warning: write controller CA: %v", err)
		return
	}
	_ = os.Setenv("FLEET_CA_FILE", caPath)
	log.Printf("downloaded controller CA to %s", caPath)
}

func buildTLSConfig() *tls.Config {
	cfg := &tls.Config{
		MinVersion: tls.VersionTLS12,
	}
	caPath := strings.TrimSpace(os.Getenv("FLEET_CA_FILE"))
	if caPath != "" {
		pem, err := os.ReadFile(caPath)
		if err != nil {
			log.Fatalf("FLEET_CA_FILE: %v", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			log.Fatalf("FLEET_CA_FILE: no certificates found in %s", caPath)
		}
		cfg.RootCAs = pool
		log.Printf("using custom CA bundle from %s", caPath)
	}
	if insecureTLSVerify() {
		cfg.InsecureSkipVerify = true
		log.Printf(
			"warning: FLEET_INSECURE_TLS=1 disables certificate verification (development only)",
		)
	}
	return cfg
}

func newSecureHTTPClient(timeout time.Duration) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = buildTLSConfig()
	transport.ForceAttemptHTTP2 = true
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
	}
}

func newWebSocketDialer() *websocket.Dialer {
	return &websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
		TLSClientConfig:  buildTLSConfig(),
		Proxy:            http.ProxyFromEnvironment,
	}
}
