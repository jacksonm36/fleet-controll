package main

import (
	"bufio"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type netSample struct {
	rxBytes uint64
	txBytes uint64
	at      time.Time
}

var (
	netMu       sync.Mutex
	lastNet     netSample
	lastCPUIdle uint64
	lastCPUTotal uint64
)

func collectMetrics() map[string]any {
	if runtime.GOOS == "linux" {
		return collectMetricsLinux()
	}
	return collectMetricsGeneric()
}

func collectMetricsLinux() map[string]any {
	cpuPct := linuxCPUPercent()
	mem := linuxMemory()
	load := linuxLoad()
	disk := linuxRootDiskPercent()
	users := linuxLoggedInUsers()
	rxBps, txBps := linuxNetworkThroughput()
	cores := runtime.NumCPU()

	healthScore, healthStatus := computeHealth(cpuPct, mem.usedPercent, disk, load.load1, float64(cores))
	primaryIP, ipAddresses := collectHostAddresses()

	host := map[string]any{}
	if primaryIP != "" {
		host["primaryIp"] = primaryIP
	}
	if len(ipAddresses) > 0 {
		host["addresses"] = ipAddresses
	}

	return map[string]any{
		"schemaVersion": 1,
		"collectedAt":   time.Now().UTC().Format(time.RFC3339),
		"cpu": map[string]any{
			"percent": cpuPct,
			"cores":   cores,
		},
		"memory": map[string]any{
			"totalBytes":  mem.total,
			"usedBytes":   mem.used,
			"usedPercent": mem.usedPercent,
		},
		"network": map[string]any{
			"rxBps": rxBps,
			"txBps": txBps,
		},
		"disk": map[string]any{
			"rootUsedPercent": disk,
		},
		"load": map[string]any{
			"load1":  load.load1,
			"load5":  load.load5,
			"load15": load.load15,
		},
		"users": map[string]any{
			"loggedIn": users,
		},
		"health": map[string]any{
			"score":  healthScore,
			"status": healthStatus,
		},
		"host": host,
	}
}

func collectMetricsGeneric() map[string]any {
	cores := runtime.NumCPU()
	healthScore, healthStatus := computeHealth(0, 0, 0, 0, float64(cores))
	primaryIP, ipAddresses := collectHostAddresses()
	host := map[string]any{}
	if primaryIP != "" {
		host["primaryIp"] = primaryIP
	}
	if len(ipAddresses) > 0 {
		host["addresses"] = ipAddresses
	}
	return map[string]any{
		"schemaVersion": 1,
		"collectedAt":   time.Now().UTC().Format(time.RFC3339),
		"cpu":           map[string]any{"percent": 0.0, "cores": cores},
		"memory":        map[string]any{"totalBytes": 0, "usedBytes": 0, "usedPercent": 0.0},
		"network":       map[string]any{"rxBps": 0.0, "txBps": 0.0},
		"disk":          map[string]any{"rootUsedPercent": 0.0},
		"load":          map[string]any{"load1": 0.0, "load5": 0.0, "load15": 0.0},
		"users":         map[string]any{"loggedIn": 0},
		"health":        map[string]any{"score": healthScore, "status": healthStatus},
		"host":          host,
	}
}

type memStats struct {
	total       uint64
	used        uint64
	usedPercent float64
}

type loadStats struct {
	load1, load5, load15 float64
}

func linuxCPUPercent() float64 {
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0
	}
	line := strings.Split(string(b), "\n")[0]
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0
	}
	var vals []uint64
	for _, f := range fields[1:] {
		v, _ := strconv.ParseUint(f, 10, 64)
		vals = append(vals, v)
	}
	if len(vals) < 4 {
		return 0
	}
	idle := vals[3]
	var total uint64
	for _, v := range vals {
		total += v
	}
	if lastCPUTotal == 0 {
		lastCPUIdle = idle
		lastCPUTotal = total
		return 0
	}
	idleDelta := idle - lastCPUIdle
	totalDelta := total - lastCPUTotal
	lastCPUIdle = idle
	lastCPUTotal = total
	if totalDelta == 0 {
		return 0
	}
	used := float64(totalDelta-idleDelta) / float64(totalDelta) * 100
	if used < 0 {
		return 0
	}
	if used > 100 {
		return 100
	}
	return used
}

func linuxMemory() memStats {
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return memStats{}
	}
	var total, avail uint64
	sc := bufio.NewScanner(strings.NewReader(string(b)))
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			total = parseMeminfoKB(line)
		} else if strings.HasPrefix(line, "MemAvailable:") {
			avail = parseMeminfoKB(line)
		}
	}
	if total == 0 {
		return memStats{}
	}
	used := total - avail
	pct := float64(used) / float64(total) * 100
	return memStats{total: total * 1024, used: used * 1024, usedPercent: pct}
}

func parseMeminfoKB(line string) uint64 {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0
	}
	v, _ := strconv.ParseUint(fields[1], 10, 64)
	return v
}

func linuxLoad() loadStats {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return loadStats{}
	}
	fields := strings.Fields(string(b))
	if len(fields) < 3 {
		return loadStats{}
	}
	l1, _ := strconv.ParseFloat(fields[0], 64)
	l5, _ := strconv.ParseFloat(fields[1], 64)
	l15, _ := strconv.ParseFloat(fields[2], 64)
	return loadStats{load1: l1, load5: l5, load15: l15}
}

func linuxRootDiskPercent() float64 {
	var st syscall.Statfs_t
	if err := syscall.Statfs("/", &st); err != nil {
		return 0
	}
	total := st.Blocks * uint64(st.Bsize)
	free := st.Bfree * uint64(st.Bsize)
	if total == 0 {
		return 0
	}
	used := total - free
	return float64(used) / float64(total) * 100
}

func linuxLoggedInUsers() int {
	out, err := exec.Command("who").Output()
	if err != nil {
		return 0
	}
	count := 0
	for _, line := range strings.Split(string(out), "\n") {
		if strings.TrimSpace(line) != "" {
			count++
		}
	}
	return count
}

func linuxNetworkThroughput() (rxBps, txBps float64) {
	b, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return 0, 0
	}
	var rx, tx uint64
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Inter-") {
			continue
		}
		parts := strings.Split(line, ":")
		if len(parts) != 2 {
			continue
		}
		iface := strings.TrimSpace(parts[0])
		if iface == "lo" {
			continue
		}
		fields := strings.Fields(parts[1])
		if len(fields) < 9 {
			continue
		}
		r, _ := strconv.ParseUint(fields[0], 10, 64)
		t, _ := strconv.ParseUint(fields[8], 10, 64)
		rx += r
		tx += t
	}
	now := time.Now()
	netMu.Lock()
	defer netMu.Unlock()
	if lastNet.at.IsZero() {
		lastNet = netSample{rxBytes: rx, txBytes: tx, at: now}
		return 0, 0
	}
	secs := now.Sub(lastNet.at).Seconds()
	if secs <= 0 {
		return 0, 0
	}
	rxBps = float64(rx-lastNet.rxBytes) / secs
	txBps = float64(tx-lastNet.txBytes) / secs
	lastNet = netSample{rxBytes: rx, txBytes: tx, at: now}
	if rxBps < 0 {
		rxBps = 0
	}
	if txBps < 0 {
		txBps = 0
	}
	return rxBps, txBps
}

func computeHealth(cpu, mem, disk, load1, cores float64) (int, string) {
	score := 100
	if cpu > 90 {
		score -= 25
	} else if cpu > 75 {
		score -= 10
	}
	if mem > 90 {
		score -= 25
	} else if mem > 80 {
		score -= 10
	}
	if disk > 90 {
		score -= 20
	} else if disk > 80 {
		score -= 8
	}
	if cores > 0 && load1 > cores*2 {
		score -= 15
	} else if cores > 0 && load1 > cores*1.5 {
		score -= 8
	}
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	status := "healthy"
	if score < 50 {
		status = "critical"
	} else if score < 80 {
		status = "degraded"
	}
	return score, status
}

func pushMetrics(cli *http.Client, base, token string) error {
	m := collectMetrics()
	var discard map[string]any
	return postJSON(cli, joinURL(base, "/api/agent/v1/metrics"), m, token, &discard)
}
