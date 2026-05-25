package main

import (
	"bytes"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"
)

func runAgent() {
	centralURL := flagString("central", getenvDefault("FLEET_CENTRAL_URL", "http://localhost:4000"))
	enrollToken := getenvDefault("FLEET_ENROLL_TOKEN", "")
	apiToken := getenvDefault("FLEET_AGENT_TOKEN", "")
	tokenFile := flagString("token-file", getenvDefault("FLEET_AGENT_TOKEN_FILE", defaultTokenPath()))
	hostnameFlag := flagString("hostname", "")
	versionFlag := flagString("version", "0.1.0")
	useSudo := getenvDefault("FLEET_USE_SUDO", autoSudoDefault())
	skipCrowdSec := getenvDefault("FLEET_SKIP_CROWDSEC", "false") == "true"

	for _, arg := range os.Args[1:] {
		switch {
		case strings.HasPrefix(arg, "-central="):
			centralURL = strings.TrimPrefix(arg, "-central=")
		case strings.HasPrefix(arg, "-enroll-token="):
			enrollToken = strings.TrimPrefix(arg, "-enroll-token=")
		case strings.HasPrefix(arg, "-token="):
			apiToken = strings.TrimPrefix(arg, "-token=")
		case strings.HasPrefix(arg, "-token-file="):
			tokenFile = strings.TrimPrefix(arg, "-token-file=")
		case strings.HasPrefix(arg, "-hostname="):
			hostnameFlag = strings.TrimPrefix(arg, "-hostname=")
		case strings.HasPrefix(arg, "-version="):
			versionFlag = strings.TrimPrefix(arg, "-version=")
		}
	}

	if enrollToken != "" {
		tok, err := enrollAgent(centralURL, enrollToken, hostnameFlag, versionFlag)
		if err != nil {
			log.Fatalf("enroll failed: %v", err)
		}
		if err := os.WriteFile(tokenFile, []byte(tok), 0o600); err != nil {
			log.Fatalf("write token file: %v", err)
		}
		fmt.Fprintf(os.Stdout, "Enrollment OK. Token saved to %s\n", tokenFile)
		apiToken = tok
	}

	if strings.TrimSpace(apiToken) == "" {
		b, err := os.ReadFile(tokenFile)
		if err != nil || len(bytes.TrimSpace(b)) == 0 {
			log.Fatal("missing agent token: set FLEET_ENROLL_TOKEN once or write token file")
		}
		apiToken = strings.TrimSpace(string(b))
	}

	httpClient := &http.Client{Timeout: 45 * time.Second}
	sudo := strings.EqualFold(useSudo, "true")

	go maintainWebSocket(centralURL, apiToken)

	inventoryTicker := time.NewTicker(10 * time.Minute)
	crowdSecTicker := time.NewTicker(5 * time.Minute)
	heartbeatTicker := time.NewTicker(45 * time.Second)

	if err := heartbeat(httpClient, centralURL, apiToken, versionFlag); err != nil {
		log.Printf("heartbeat error: %v", err)
	}
	if err := pushInventory(httpClient, centralURL, apiToken, sudo); err != nil {
		log.Printf("initial inventory error: %v", err)
	}
	if !skipCrowdSec {
		if err := pushCrowdSec(httpClient, centralURL, apiToken); err != nil {
			log.Printf("crowdsec snapshot error: %v", err)
		}
	}

	go func() {
		for range heartbeatTicker.C {
			if err := heartbeat(httpClient, centralURL, apiToken, versionFlag); err != nil {
				log.Printf("heartbeat error: %v", err)
			}
		}
	}()

	go func() {
		for range inventoryTicker.C {
			if err := pushInventory(httpClient, centralURL, apiToken, sudo); err != nil {
				log.Printf("inventory error: %v", err)
			}
		}
	}()

	go func() {
		for range crowdSecTicker.C {
			if skipCrowdSec {
				continue
			}
			if err := pushCrowdSec(httpClient, centralURL, apiToken); err != nil {
				log.Printf("crowdsec snapshot error: %v", err)
			}
		}
	}()

	commandLoop(httpClient, centralURL, apiToken, sudo)
}

func heartbeat(cli *http.Client, base, token, version string) error {
	body := map[string]any{"version": version}
	var discard map[string]any
	return postJSON(cli, joinURL(base, "/api/agent/v1/heartbeat"), body, token, &discard)
}

func pushInventory(cli *http.Client, base, token string, sudo bool) error {
	inv, err := collectInventory(sudo)
	if err != nil {
		return err
	}
	var discard map[string]any
	return postJSON(cli, joinURL(base, "/api/agent/v1/inventory"), inv, token, &discard)
}

func pushCrowdSec(cli *http.Client, base, token string) error {
	snap, ok := collectCrowdSecSnapshot()
	if !ok {
		return nil
	}
	var discard map[string]any
	return postJSON(cli, joinURL(base, "/api/agent/v1/crowdsec/snapshot"), snap, token, &discard)
}

func commandLoop(cli *http.Client, base, token string, sudo bool) {
	poll := &http.Client{Timeout: 35 * time.Second}
	for {
		job, status, err := fetchNextJob(poll, base, token)
		if err != nil {
			log.Printf("commands poll error: %v", err)
			time.Sleep(3 * time.Second)
			continue
		}
		if status == http.StatusNoContent || job == nil {
			continue
		}
		runJob(cli, base, token, job, sudo)
	}
}

func enrollAgent(base, token, hostname, version string) (string, error) {
	if strings.TrimSpace(hostname) == "" {
		h, err := os.Hostname()
		if err != nil {
			return "", err
		}
		hostname = h
	}
	body := map[string]any{
		"token":    token,
		"hostname": hostname,
		"osType":   runtime.GOOS,
		"osDetail": collectOSDetail(),
		"version":  version,
	}
	var out enrollResponse
	if err := postJSON(http.DefaultClient, joinURL(base, "/api/agent/v1/enroll"), body, "", &out); err != nil {
		return "", err
	}
	if strings.TrimSpace(out.APIToken) == "" {
		return "", errors.New("missing api token from server")
	}
	return out.APIToken, nil
}
