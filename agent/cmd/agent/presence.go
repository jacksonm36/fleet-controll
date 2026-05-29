package main

import (
	"context"
	"strconv"
	"sync"
)

var (
	commandPollMu      sync.Mutex
	commandPollCancel  context.CancelFunc
)

func setCommandPollCancel(cancel context.CancelFunc) {
	commandPollMu.Lock()
	commandPollCancel = cancel
	commandPollMu.Unlock()
}

func clearCommandPollCancel() {
	commandPollMu.Lock()
	commandPollCancel = nil
	commandPollMu.Unlock()
}

func wakeCommandPoll() {
	commandPollMu.Lock()
	cancel := commandPollCancel
	commandPollMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func durationFromEnvSec(key string, defaultSec int) int {
	if v := getenvDefault(key, ""); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return defaultSec
}
