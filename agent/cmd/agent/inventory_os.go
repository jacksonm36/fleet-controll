package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

func fleetOsType() string {
	switch runtime.GOOS {
	case "darwin":
		return "darwin"
	case "windows":
		return "windows"
	case "freebsd":
		return "freebsd"
	case "openbsd":
		return "openbsd"
	case "netbsd":
		return "netbsd"
	case "linux":
		return "linux"
	default:
		return runtime.GOOS
	}
}

func collectOSDetail() string {
	var raw string
	switch runtime.GOOS {
	case "linux":
		raw = collectOSDetailLinux()
	case "windows":
		raw = collectOSDetailWindows()
	case "darwin":
		raw = collectOSDetailDarwin()
	case "freebsd":
		raw = collectOSDetailFreeBSD()
	default:
		raw = collectOSDetailGeneric()
	}
	return truncateOSDetail(raw)
}

func truncateOSDetail(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 512 {
		return s[:512]
	}
	return s
}

func collectOSDetailLinux() string {
	for _, path := range []string{"/etc/os-release", "/usr/lib/os-release"} {
		b, err := os.ReadFile(path)
		if err == nil && len(bytes.TrimSpace(b)) > 0 {
			return strings.TrimSpace(string(b))
		}
	}
	return collectOSDetailGeneric()
}

func collectOSDetailWindows() string {
	ps := "$o = Get-CimInstance Win32_OperatingSystem; " +
		"$name = 'Windows'; $pretty = $o.Caption; $ver = $o.Version; $build = $o.BuildNumber; " +
		"'NAME=' + $name + \"`nPRETTY_NAME=\" + $pretty + \"`nVERSION_ID=\" + $ver + \"`nID=windows`nBUILD=\" + $build"
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", ps)
	out, err := cmd.Output()
	if err != nil {
		return "NAME=Windows\nID=windows"
	}
	return strings.TrimSpace(string(out))
}

func collectOSDetailDarwin() string {
	product := strings.TrimSpace(runText("sw_vers", "-productName"))
	version := strings.TrimSpace(runText("sw_vers", "-productVersion"))
	build := strings.TrimSpace(runText("sw_vers", "-buildVersion"))
	if product == "" {
		product = "macOS"
	}
	lines := []string{
		"NAME=macOS",
		fmt.Sprintf("PRETTY_NAME=%s %s", product, version),
		"ID=darwin",
	}
	if version != "" {
		lines = append(lines, "VERSION_ID="+version)
	}
	if build != "" {
		lines = append(lines, "BUILD="+build)
	}
	return strings.Join(lines, "\n")
}

func collectOSDetailFreeBSD() string {
	if b, err := os.ReadFile("/etc/os-release"); err == nil && len(bytes.TrimSpace(b)) > 0 {
		return strings.TrimSpace(string(b))
	}
	ver := strings.TrimSpace(runText("freebsd-version", "-u"))
	if ver == "" {
		ver = strings.TrimSpace(runText("uname", "-r"))
	}
	pretty := "FreeBSD"
	if ver != "" {
		pretty = "FreeBSD " + ver
	}
	return strings.Join([]string{
		"NAME=FreeBSD",
		"PRETTY_NAME=" + pretty,
		"VERSION_ID=" + strings.Split(ver, "-")[0],
		"ID=freebsd",
	}, "\n")
}

func collectOSDetailGeneric() string {
	kernel := strings.TrimSpace(runText("uname", "-s"))
	release := strings.TrimSpace(runText("uname", "-r"))
	machine := strings.TrimSpace(runText("uname", "-m"))
	pretty := strings.TrimSpace(strings.Join([]string{kernel, release}, " "))
	if pretty == "" {
		pretty = runtime.GOOS
	}
	return strings.Join([]string{
		"NAME=" + kernel,
		"PRETTY_NAME=" + pretty,
		"VERSION_ID=" + release,
		"ID=" + runtime.GOOS,
		"MACHINE=" + machine,
	}, "\n")
}

func runText(name string, args ...string) string {
	out, err := exec.Command(name, args...).Output()
	if err != nil {
		return ""
	}
	return string(out)
}
