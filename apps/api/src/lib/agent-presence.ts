/** How recently an agent must have checked in to count as online. */
/** Default ~6 missed 10s heartbeats before showing stale (was 45s — too aggressive). */
export const AGENT_ONLINE_THRESHOLD_MS = Number(
  process.env.AGENT_ONLINE_THRESHOLD_MS ?? 120_000,
);

/** Metrics older than this are treated as stale in monitoring views. */
export const AGENT_METRICS_STALE_MS = Number(
  process.env.AGENT_METRICS_STALE_MS ?? AGENT_ONLINE_THRESHOLD_MS,
);

export function isAgentOnline(
  lastSeenAt: Date | null | undefined,
  status: string,
  now = Date.now(),
): boolean {
  return (
    !!lastSeenAt &&
    lastSeenAt.getTime() >= now - AGENT_ONLINE_THRESHOLD_MS &&
    status === "ONLINE"
  );
}

export function isMetricsStale(
  lastMetricsAt: Date | null | undefined,
  now = Date.now(),
): boolean {
  if (!lastMetricsAt) return true;
  return now - lastMetricsAt.getTime() > AGENT_METRICS_STALE_MS;
}

export function onlineThresholdDate(now = Date.now()): Date {
  return new Date(now - AGENT_ONLINE_THRESHOLD_MS);
}
