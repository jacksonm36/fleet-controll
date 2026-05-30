package main

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
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

func defaultFleetDir() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, ".fleet")
}

func defaultCAPath() string {
	dir := defaultFleetDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "ca.crt")
}

func defaultMtlsCertPath() string {
	dir := defaultFleetDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "agent-client.crt")
}

func defaultMtlsKeyPath() string {
	dir := defaultFleetDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "agent-client.key")
}

func tlsServerName(base string) string {
	if v := strings.TrimSpace(os.Getenv("FLEET_TLS_SERVER_NAME")); v != "" {
		return v
	}
	u, err := url.Parse(strings.TrimSpace(base))
	if err != nil || u.Hostname() == "" {
		return ""
	}
	return u.Hostname()
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
	cfg := &tls.Config{}
	applySessionCipherPrefs(cfg)
	applyCertPin(cfg)
	if insecureTLSVerify() && !hasTlsPin() {
		cfg.InsecureSkipVerify = true
	}
	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: cfg,
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

func loadClientCertificate() []tls.Certificate {
	certPath := strings.TrimSpace(os.Getenv("FLEET_MTLS_CERT"))
	keyPath := strings.TrimSpace(os.Getenv("FLEET_MTLS_KEY"))
	if certPath == "" {
		certPath = defaultMtlsCertPath()
	}
	if keyPath == "" {
		keyPath = defaultMtlsKeyPath()
	}
	if certPath == "" || keyPath == "" {
		return nil
	}
	if _, err := os.Stat(certPath); err != nil {
		return nil
	}
	if _, err := os.Stat(keyPath); err != nil {
		return nil
	}
	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		log.Printf("warning: load mTLS client cert: %v", err)
		return nil
	}
	log.Printf("using mTLS client certificate from %s", certPath)
	return []tls.Certificate{cert}
}

func saveAgentMtlsMaterial(certPem, keyPem string) error {
	certPath := strings.TrimSpace(os.Getenv("FLEET_MTLS_CERT"))
	keyPath := strings.TrimSpace(os.Getenv("FLEET_MTLS_KEY"))
	if certPath == "" {
		certPath = defaultMtlsCertPath()
	}
	if keyPath == "" {
		keyPath = defaultMtlsKeyPath()
	}
	if certPath == "" || keyPath == "" {
		return fmt.Errorf("no path for mTLS material")
	}
	if err := os.MkdirAll(filepath.Dir(certPath), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(certPath, []byte(certPem), 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(keyPath, []byte(keyPem), 0o600); err != nil {
		return err
	}
	log.Printf("saved mTLS client certificate to %s", certPath)
	return nil
}

// applySessionCipherPrefs prefers TLS 1.3 and ChaCha20-Poly1305 / AES-GCM for TLS 1.2.
// SHA-* inside those suites is for the TLS protocol, not a substitute for cert pinning.
func applySessionCipherPrefs(cfg *tls.Config) {
	if v := strings.ToLower(strings.TrimSpace(os.Getenv("FLEET_TLS_MIN_VERSION"))); v == "1.3" || v == "tls1.3" || v == "tls13" {
		cfg.MinVersion = tls.VersionTLS13
	} else {
		cfg.MinVersion = tls.VersionTLS12
	}
	cfg.CipherSuites = []uint16{
		tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305,
		tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305,
		tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
		tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
		tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
		tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
	}
	cfg.CurvePreferences = []tls.CurveID{tls.X25519, tls.CurveP256}
}

func buildTLSConfig(base string) *tls.Config {
	cfg := &tls.Config{}
	applySessionCipherPrefs(cfg)
	if sn := tlsServerName(base); sn != "" {
		cfg.ServerName = sn
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
	if certs := loadClientCertificate(); len(certs) > 0 {
		cfg.Certificates = certs
	}
	applyCertPin(cfg)
	if hasTlsPin() {
		if p := loadTlsPin(); p != nil {
			log.Printf("TLS: SPKI pin active (%s)", p.algo)
		}
	}
	if cfg.MinVersion == tls.VersionTLS13 {
		log.Printf("TLS: minimum version 1.3; prefers ChaCha20-Poly1305 / AES-GCM")
	} else {
		log.Printf("TLS: minimum version 1.2; prefers ChaCha20-Poly1305 / AES-GCM")
	}
	if insecureTLSVerify() {
		cfg.InsecureSkipVerify = true
		log.Printf(
			"warning: FLEET_INSECURE_TLS=1 disables certificate verification (development only)",
		)
	}
	return cfg
}

func newSecureHTTPClient(timeout time.Duration, base string) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = buildTLSConfig(base)
	transport.ForceAttemptHTTP2 = true
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
	}
}

func newWebSocketDialer(base string) *websocket.Dialer {
	return &websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
		TLSClientConfig:  buildTLSConfig(base),
		Proxy:            http.ProxyFromEnvironment,
	}
}
