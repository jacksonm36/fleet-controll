package main

// collectHealthPing is a lightweight status snapshot for frequent heartbeats (no full inventory).
func collectHealthPing(sudo bool) map[string]any {
	kernel := collectKernelInfo(sudo)
	out := map[string]any{
		"rebootRequired": rebootRequired(),
	}
	if v, ok := kernel["running"].(string); ok && v != "" {
		out["kernelRunning"] = v
	}
	if v, ok := kernel["latestInstalled"].(string); ok && v != "" {
		out["kernelInstalled"] = v
	}
	if v, ok := kernel["updatePending"].(bool); ok {
		out["kernelUpdatePending"] = v
	}
	return out
}
