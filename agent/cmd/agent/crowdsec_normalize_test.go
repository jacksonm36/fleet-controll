package main

import "testing"

func TestFlattenCrowdSecDecisions_nested(t *testing.T) {
	raw := []any{
		map[string]any{
			"id":       float64(2264),
			"scenario": "crowdsecurity/http-probing",
			"source": map[string]any{
				"ip": "203.0.113.10",
			},
			"decisions": []any{
				map[string]any{
					"id":       float64(479326),
					"origin":   "crowdsec",
					"scope":    "Ip",
					"value":    "203.0.113.10",
					"type":     "ban",
					"duration": "3h56m",
					"scenario": "crowdsecurity/http-probing",
				},
			},
		},
	}

	flat := flattenCrowdSecDecisions(raw)
	if len(flat) != 1 {
		t.Fatalf("expected 1 flat decision, got %d", len(flat))
	}
	if flat[0]["value"] != "203.0.113.10" {
		t.Fatalf("unexpected value: %v", flat[0]["value"])
	}
	if flat[0]["type"] != "ban" {
		t.Fatalf("unexpected type: %v", flat[0]["type"])
	}
}
