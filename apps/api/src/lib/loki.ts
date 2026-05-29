/**
 * Query Loki log streams (Promtail → Loki on controller).
 */

export type LokiLogLine = {
  ts: string;
  line: string;
  labels: Record<string, string>;
};

function lokiBaseUrl(): string | null {
  const url = process.env.LOKI_URL?.trim();
  if (!url) return null;
  return url.replace(/\/$/, "");
}

export function lokiConfigured(): boolean {
  return lokiBaseUrl() !== null;
}

let hostnameCache: { at: number; values: string[] } | null = null;

/** Hostnames present in Loki journal streams (usually the controller only). */
export async function listLokiJournalHostnames(): Promise<string[]> {
  const base = lokiBaseUrl();
  if (!base) return [];
  const now = Date.now();
  if (hostnameCache && now - hostnameCache.at < 60_000) {
    return hostnameCache.values;
  }
  try {
    const res = await fetch(`${base}/loki/api/v1/label/hostname/values`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: string[] };
    const values = body.data ?? [];
    hostnameCache = { at: now, values };
    return values;
  } catch {
    return [];
  }
}

export async function agentHasJournalInLoki(hostname: string): Promise<boolean> {
  const hosts = await listLokiJournalHostnames();
  return hosts.includes(hostname);
}

function rangeToNs(range: "1h" | "6h" | "24h"): { start: string; end: string } {
  const end = Date.now() * 1_000_000;
  const hours = range === "24h" ? 24 : range === "6h" ? 6 : 1;
  const start = end - hours * 60 * 60 * 1_000_000_000;
  return { start: String(start), end: String(end) };
}

function escLogqlLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Journal logs tagged with agent hostname (when Promtail sees that host). */
export function logqlForHostname(hostname: string): string {
  const h = escLogqlLabel(hostname);
  return `{job="systemd-journal", hostname="${h}"}`;
}

/** Fleet agent unit on any host in journal. */
export function logqlFleetAgent(hostname: string): string {
  const h = escLogqlLabel(hostname);
  return `{job="systemd-journal", unit=~"fleet-agent.*", hostname="${h}"}`;
}

/** Controller fleet services (API/web). */
export const LOGQL_FLEET_CONTROLLER =
  '{job="systemd-journal", unit=~"fleet-(api|web|agent).*"}';

export async function queryLokiRange(
  logql: string,
  range: "1h" | "6h" | "24h" = "1h",
  limit = 300,
): Promise<LokiLogLine[]> {
  const base = lokiBaseUrl();
  if (!base) return [];

  const { start, end } = rangeToNs(range);
  const params = new URLSearchParams({
    query: logql,
    limit: String(limit),
    start,
    end,
    direction: "backward",
  });

  const res = await fetch(`${base}/loki/api/v1/query_range?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`loki query failed ${res.status}: ${text.slice(0, 300)}`);
  }

  const body = (await res.json()) as {
    data?: {
      result?: Array<{
        stream?: Record<string, string>;
        values?: [string, string][];
      }>;
    };
  };

  const lines: LokiLogLine[] = [];
  for (const stream of body.data?.result ?? []) {
    const labels = stream.stream ?? {};
    for (const [tsNs, line] of stream.values ?? []) {
      const ms = Number(tsNs) / 1_000_000;
      lines.push({
        ts: Number.isFinite(ms)
          ? new Date(ms).toISOString()
          : new Date().toISOString(),
        line,
        labels,
      });
    }
  }
  lines.sort((a, b) => b.ts.localeCompare(a.ts));
  return lines;
}

export function grafanaExploreLogsUrl(hostname: string): string {
  const base = (
    process.env.GRAFANA_PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_GRAFANA_URL?.trim() ||
    "http://127.0.0.1:3002"
  ).replace(/\/$/, "");
  const expr = logqlForHostname(hostname);
  const panes = {
    a: {
      datasource: "fleet-loki",
      queries: [{ refId: "A", expr, queryType: "range" }],
      range: { from: "now-1h", to: "now" },
    },
  };
  return `${base}/explore?orgId=1&left=${encodeURIComponent(JSON.stringify(panes))}`;
}
