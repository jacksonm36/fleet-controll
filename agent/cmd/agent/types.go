package main

import "encoding/json"

type enrollResponse struct {
	AgentID  string `json:"agentId"`
	APIToken string `json:"apiToken"`
}

type jobRecord struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
	Status  string          `json:"status"`
}
