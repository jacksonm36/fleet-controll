package main

import (
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

func maintainWebSocket(base, token string) {
	d := websocket.Dialer{HandshakeTimeout: 10 * time.Second}

	for {
		streamURL := websocketURL(joinURL(base, "/api/agent/v1/stream"))
		u, err := url.Parse(streamURL)
		if err != nil {
			time.Sleep(5 * time.Second)
			continue
		}
		q := u.Query()
		q.Set("token", token)
		u.RawQuery = q.Encode()

		conn, _, err := d.Dial(u.String(), nil)
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
		}
		_ = conn.Close()
		time.Sleep(2 * time.Second)
	}
}

func websocketURL(httpURL string) string {
	u := strings.TrimSpace(httpURL)
	u = strings.Replace(u, "https://", "wss://", 1)
	u = strings.Replace(u, "http://", "ws://", 1)
	return u
}
