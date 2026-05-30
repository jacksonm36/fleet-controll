package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

func runAgent() {
	centralURL := flagString("central", getenvDefault("FLEET_CENTRAL_URL", "http://localhost:4000"))
	enrollToken := getenvDefault("FLEET_ENROLL_TOKEN", "")
	apiToken := getenvDefault("FLEET_AGENT_TOKEN", "")
	tokenFile := flagString("token-file", getenvDefault("FLEET_AGENT_TOKEN_FILE", defaultTokenPath()))
	hostnameFlag := flagString("hostname", "")
	versionFlag := flagString("version", agentVersionString())
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

	centralURL = strings.TrimRight(strings.TrimSpace(centralURL), "/")
	ensureControllerCA(centralURL)
	loadTlsPinFromFile()

	if err := validateCentralURL(centralURL); err != nil {
		log.Fatalf("invalid controller URL: %v", err)
	}

	log.Printf(
		"fleet-agent starting version=%s build=%s arch=%s controller=%s",
		agentVersionString(),
		agentBuildID(),
		runtimeArchKey(),
		centralURL,
	)
	logPendingUpgradeSuccess()

	httpClient := newSecureHTTPClient(45*time.Second, centralURL)
	sudo := strings.EqualFold(useSudo, "true")

	runAgentSelfHeal(httpClient, centralURL, apiToken)
	startSelfHealLoop(httpClient, centralURL, apiToken)

	go maintainWebSocket(centralURL, apiToken, httpClient)

	inventorySec := durationFromEnvSec("FLEET_INVENTORY_INTERVAL_SEC", 180)
	inventoryTicker := time.NewTicker(time.Duration(inventorySec) * time.Second)
	crowdSecTicker := time.NewTicker(5 * time.Minute)
	heartbeatSec := durationFromEnvSec("FLEET_HEARTBEAT_INTERVAL_SEC", 10)
	metricsSec := durationFromEnvSec("FLEET_METRICS_INTERVAL_SEC", 5)
	heartbeatTicker := time.NewTicker(time.Duration(heartbeatSec) * time.Second)
	metricsTicker := time.NewTicker(time.Duration(metricsSec) * time.Second)

	if err := heartbeat(httpClient, centralURL, apiToken, versionFlag, sudo); err != nil {
		log.Printf("heartbeat error: %v", err)
	}
	if err := pushMetrics(httpClient, centralURL, apiToken); err != nil {
		log.Printf("metrics error: %v", err)
	}
	if err := pushInventory(httpClient, centralURL, apiToken, sudo); err != nil {
		log.Printf("initial inventory error: %v", err)
	} else {
		logHealthPing(sudo)
	}
	if !skipCrowdSec {
		if err := pushCrowdSec(httpClient, centralURL, apiToken); err != nil {
			log.Printf("crowdsec snapshot error: %v", err)
		}
	}

	go func() {
		for range metricsTicker.C {
			if err := pushMetrics(httpClient, centralURL, apiToken); err != nil {
				log.Printf("metrics error: %v", err)
			}
		}
	}()

	go func() {
		for range heartbeatTicker.C {
			if err := heartbeat(httpClient, centralURL, apiToken, versionFlag, sudo); err != nil {
				log.Printf("heartbeat error: %v", err)
			}
		}
	}()

	go func() {
		for range inventoryTicker.C {
			if err := pushInventory(httpClient, centralURL, apiToken, sudo); err != nil {
				log.Printf("inventory error: %v", err)
			} else {
				logHealthPing(sudo)
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

func heartbeat(cli *http.Client, base, token, version string, sudo bool) error {
	body := map[string]any{
		"version": version,
		"build":   agentBuildID(),
		"arch":    runtimeArchKey(),
		"health":  collectHealthPing(sudo),
	}
	var out struct {
		BinaryUpdate *binaryUpdateOffer `json:"binaryUpdate"`
	}
	if err := postJSON(cli, joinURL(base, "/api/agent/v1/heartbeat"), body, token, &out); err != nil {
		return err
	}
	maybeApplyBinaryUpdate(cli, base, token, out.BinaryUpdate)
	return nil
}

func logHealthPing(sudo bool) {
	h := collectHealthPing(sudo)
	running, _ := h["kernelRunning"].(string)
	installed, _ := h["kernelInstalled"].(string)
	pending, _ := h["kernelUpdatePending"].(bool)
	reboot, _ := h["rebootRequired"].(bool)
	log.Printf(
		"health: kernel running=%s installed=%s updatePending=%v rebootRequired=%v",
		running,
		installed,
		pending,
		reboot,
	)
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
	poll := newSecureHTTPClient(35*time.Second, base)
	for {
		ctx, cancel := context.WithCancel(context.Background())
		setCommandPollCancel(cancel)
		job, status, err := fetchNextJob(ctx, poll, base, token)
		clearCommandPollCancel()
		cancel()
		if errors.Is(err, context.Canceled) {
			continue
		}
		if err != nil {
			log.Printf("commands poll error: %v", err)
			time.Sleep(2 * time.Second)
			continue
		}
		if status == http.StatusNoContent || job == nil {
			continue
		}
		runJob(cli, base, token, job, sudo)
	}
}

func enrollAgent(base, token, hostname, version string) (string, error) {
	body := map[string]any{
		"token":    token,
		"hostname": enrollHostnameFlag(hostname),
		"osType":   fleetOsType(),
		"osDetail": enrollOSDetail(),
		"version":  version,
	}
	if fleet := strings.TrimSpace(getenvDefault("FLEET_HOSTNAME", "")); fleet != "" {
		body["fleetHostname"] = normalizeEnrollHostname(fleet)
	}
	var out enrollResponse
	if err := validateCentralURL(base); err != nil {
		return "", err
	}
	cli := newSecureHTTPClient(45*time.Second, base)
	if err := postJSON(cli, joinURL(base, "/api/agent/v1/enroll"), body, "", &out); err != nil {
		return "", err
	}
	if strings.TrimSpace(out.APIToken) == "" {
		return "", errors.New("missing api token from server")
	}
	if strings.TrimSpace(out.MtlsCert) != "" && strings.TrimSpace(out.MtlsKey) != "" {
		if err := saveAgentMtlsMaterial(out.MtlsCert, out.MtlsKey); err != nil {
			log.Printf("warning: save mTLS material: %v", err)
		}
	}
	return out.APIToken, nil
}
