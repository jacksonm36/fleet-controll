package main

import "strings"

// AgentVersion and AgentBuild are set at link time via -ldflags.
var (
	AgentVersion = "0.4.0"
	AgentBuild   = "dev"
)

func agentVersionString() string {
	build := strings.TrimSpace(AgentBuild)
	if build == "" || build == "dev" {
		return AgentVersion
	}
	return AgentVersion + "+" + build
}

func agentBuildID() string {
	return strings.TrimSpace(AgentBuild)
}

func runtimeArchKey() string {
	switch runtimeGOARCH() {
	case "amd64":
		return "linux-amd64"
	case "arm64":
		return "linux-arm64"
	default:
		return "linux-" + runtimeGOARCH()
	}
}

func runtimeGOARCH() string {
	// tiny indirection keeps version.go free of extra imports in tests
	return goArch()
}
