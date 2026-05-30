package main

import (
	"fmt"
	"strings"
)

// cscli decisions list -o json returns alerts with nested Decisions[], not flat rows.
func flattenCrowdSecDecisions(raw any) []map[string]any {
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		rec, ok := item.(map[string]any)
		if !ok {
			continue
		}
		nested := nestedDecisionMaps(rec)
		if len(nested) > 0 {
			for _, d := range nested {
				out = append(out, mergeAlertDecision(rec, d))
			}
			continue
		}
		if looksLikeDecision(rec) {
			out = append(out, rec)
		}
	}
	return out
}

func nestedDecisionMaps(alert map[string]any) []map[string]any {
	for _, key := range []string{"decisions", "Decisions"} {
		raw, ok := alert[key]
		if !ok {
			continue
		}
		items, ok := raw.([]any)
		if !ok || len(items) == 0 {
			continue
		}
		out := make([]map[string]any, 0, len(items))
		for _, item := range items {
			if m, ok := item.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	}
	return nil
}

func looksLikeDecision(m map[string]any) bool {
	scope := stringField(m, "scope", "Scope")
	value := stringField(m, "value", "Value")
	return scope != "" && value != ""
}

func mergeAlertDecision(alert, decision map[string]any) map[string]any {
	merged := map[string]any{}
	for k, v := range decision {
		merged[k] = v
	}
	if stringField(merged, "scenario", "Scenario") == "" {
		if s := stringField(alert, "scenario", "Scenario"); s != "" {
			merged["scenario"] = s
		}
	}
	if _, ok := merged["source"]; !ok {
		if src, ok := alert["source"]; ok {
			merged["source"] = src
		}
	}
	if _, ok := merged["alertId"]; !ok {
		if id := stringField(alert, "id", "ID"); id != "" {
			merged["alertId"] = id
		}
	}
	return merged
}

func stringField(m map[string]any, keys ...string) string {
	for _, k := range keys {
		v, ok := m[k]
		if !ok {
			continue
		}
		switch t := v.(type) {
		case string:
			if s := strings.TrimSpace(t); s != "" {
				return s
			}
		case float64:
			if t == float64(int64(t)) {
				return fmt.Sprintf("%d", int64(t))
			}
			return fmt.Sprintf("%v", t)
		case int:
			return fmt.Sprintf("%d", t)
		case int64:
			return fmt.Sprintf("%d", t)
		}
	}
	return ""
}
