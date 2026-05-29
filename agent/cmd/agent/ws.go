package main

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func maintainWebSocket(base, token string, cli *http.Client) {
	d := newWebSocketDialer()

	for {
		streamURL := websocketURL(joinURL(base, "/api/agent/v1/stream"))
		u, err := url.Parse(streamURL)
		if err != nil {
			time.Sleep(5 * time.Second)
			continue
		}

		hdr := http.Header{}
		hdr.Set("Authorization", "Bearer "+token)

		conn, _, err := d.Dial(u.String(), hdr)
		if err != nil {
			time.Sleep(5 * time.Second)
			continue
		}

		log.Printf("websocket connected (%s)", u.Host)

		for {
			conn.SetReadDeadline(time.Now().Add(120 * time.Second))
			_, msg, err := conn.ReadMessage()
			if err != nil {
				log.Printf("websocket ended: %v", err)
				break
			}
			log.Printf("websocket: %s", string(msg))
			handleWebSocketMessage(cli, base, token, msg)
		}
		_ = conn.Close()
		time.Sleep(2 * time.Second)
	}
}

func handleWebSocketMessage(cli *http.Client, base, token string, raw []byte) {
	var envelope struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(raw, &envelope) != nil {
		return
	}
	switch envelope.Type {
	case "poll_commands", "wake":
		wakeCommandPoll()
	case "upgrade_binary", "agent_upgrade":
		triggerBinaryUpdateCheck(cli, base, token)
		wakeCommandPoll()
	}
}

func websocketURL(httpURL string) string {
	u := strings.TrimSpace(httpURL)
	u = strings.Replace(u, "https://", "wss://", 1)
	u = strings.Replace(u, "http://", "ws://", 1)
	return u
}
