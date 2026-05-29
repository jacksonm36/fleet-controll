package main

import (
	"net"
	"runtime"
	"strings"
)

func collectHostAddresses() (primary string, all []string) {
	if runtime.GOOS == "linux" {
		return collectHostAddressesLinux()
	}
	return collectHostAddressesGeneric()
}

func collectHostAddressesGeneric() (string, []string) {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return "", nil
	}
	var all []string
	for _, addr := range addrs {
		ip := ipFromAddr(addr)
		if ip == "" {
			continue
		}
		all = append(all, ip)
	}
	if len(all) == 0 {
		return "", nil
	}
	return all[0], all
}

func collectHostAddressesLinux() (string, []string) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return collectHostAddressesGeneric()
	}

	type candidate struct {
		ip     string
		iface  string
		score  int
	}
	var candidates []candidate

	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		name := iface.Name
		if isVirtualInterface(name) {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ip := ipFromAddr(addr)
			if ip == "" {
				continue
			}
			candidates = append(candidates, candidate{
				ip:    ip,
				iface: name,
				score: scoreInterface(name, ip),
			})
		}
	}

	if len(candidates) == 0 {
		return collectHostAddressesGeneric()
	}

	best := candidates[0]
	seen := map[string]struct{}{}
	var all []string
	for _, c := range candidates {
		if _, ok := seen[c.ip]; ok {
			continue
		}
		seen[c.ip] = struct{}{}
		all = append(all, c.ip)
		if c.score > best.score {
			best = c
		}
	}
	return best.ip, all
}

func ipFromAddr(addr net.Addr) string {
	ipnet, ok := addr.(*net.IPNet)
	if !ok || ipnet.IP.To4() == nil {
		return ""
	}
	ip := ipnet.IP
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsMulticast() {
		return ""
	}
	return ip.String()
}

func isVirtualInterface(name string) bool {
	lower := strings.ToLower(name)
	prefixes := []string{
		"docker", "br-", "veth", "virbr", "vmnet", "vboxnet", "tun", "tap", "wg",
	}
	for _, p := range prefixes {
		if strings.HasPrefix(lower, p) {
			return true
		}
	}
	return false
}

func scoreInterface(name, ip string) int {
	score := 0
	lower := strings.ToLower(name)
	switch {
	case strings.HasPrefix(lower, "eth"):
		score += 100
	case strings.HasPrefix(lower, "en"):
		score += 90
	case strings.HasPrefix(lower, "wlan"), strings.HasPrefix(lower, "wl"):
		score += 80
	default:
		score += 10
	}
	if strings.HasPrefix(ip, "192.168.") || strings.HasPrefix(ip, "10.") {
		score += 20
	}
	return score
}
