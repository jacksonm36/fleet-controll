/**
 * Write host metrics to InfluxDB 2.x (line protocol over HTTP).
 */

export type InfluxConfig = {
  url: string;
  token: string;
  org: string;
  bucket: string;
};

export function resolveInfluxConfig(): InfluxConfig | null {
  const url = process.env.INFLUX_URL?.trim();
  const token = process.env.INFLUX_TOKEN?.trim();
  const org = process.env.INFLUX_ORG?.trim() || "fleet";
  const bucket = process.env.INFLUX_BUCKET?.trim() || "host_metrics";
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token, org, bucket };
}

export function influxConfigured(): boolean {
  return resolveInfluxConfig() !== null;
}

export function grafanaPublicUrl(): string {
  return (
    process.env.GRAFANA_PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_GRAFANA_URL?.trim() ||
    "http://127.0.0.1:3002"
  );
}

export type AgentMetricPoint = {
  agentId: string;
  hostname: string;
  osType: string;
  collectedAt: Date;
  cpuPercent: number;
  memUsedPercent: number;
  load1: number;
  networkRxBps: number;
  networkTxBps: number;
  diskRootUsedPercent: number;
  loggedInUsers: number;
  healthScore: number;
  healthStatus: string;
};

function escTag(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/ /g, "\\ ").replace(/=/g, "\\=");
}

function escField(v: string): string {
  return v.replace(/"/g, '\\"');
}

export async function writeAgentMetricsToInflux(
  point: AgentMetricPoint,
): Promise<void> {
  const cfg = resolveInfluxConfig();
  if (!cfg) return;

  const ts = point.collectedAt.getTime() * 1_000_000;
  const tags = [
    `agent_id=${escTag(point.agentId)}`,
    `hostname=${escTag(point.hostname)}`,
    `os_type=${escTag(point.osType)}`,
  ].join(",");
  const fields = [
    `cpu_percent=${point.cpuPercent}`,
    `mem_used_percent=${point.memUsedPercent}`,
    `load1=${point.load1}`,
    `network_rx_bps=${point.networkRxBps}`,
    `network_tx_bps=${point.networkTxBps}`,
    `disk_root_used_percent=${point.diskRootUsedPercent}`,
    `logged_in_users=${point.loggedInUsers}`,
    `health_score=${point.healthScore}`,
    `health_status="${escField(point.healthStatus)}"`,
  ].join(",");
  const line = `host_metrics,${tags} ${fields} ${ts}`;

  const url = `${cfg.url}/api/v2/write?org=${encodeURIComponent(cfg.org)}&bucket=${encodeURIComponent(cfg.bucket)}&precision=ns`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${cfg.token}`,
      "Content-Type": "text/plain; charset=utf-8",
    },
    body: line,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`influx write failed ${res.status}: ${text.slice(0, 200)}`);
  }
}

export type MetricHistoryRange = "1h" | "6h" | "24h";

const HISTORY_FIELDS = [
  "cpu_percent",
  "mem_used_percent",
  "network_rx_bps",
  "network_tx_bps",
  "disk_root_used_percent",
  "load1",
  "logged_in_users",
  "health_score",
] as const;

export type MetricHistoryField = (typeof HISTORY_FIELDS)[number];

export type MetricHistoryPoint = { t: string; v: number };

export type AgentMetricHistory = Partial<
  Record<MetricHistoryField, MetricHistoryPoint[]>
>;

/** Parse Influx annotated CSV from Flux query (pivoted table). */
function parseInfluxPivotCsv(csv: string): AgentMetricHistory {
  const lines = csv.split("\n");
  const out: AgentMetricHistory = {};
  let header: string[] | null = null;

  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const cols = line.split(",");
    if (!header) {
      header = cols.map((c) => c.trim());
      continue;
    }
    if (!header.length) continue;

    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i]!] = cols[i]?.trim() ?? "";
    }

    const time = row._time;
    if (!time) continue;

    for (const field of HISTORY_FIELDS) {
      const raw = row[field];
      if (raw === undefined || raw === "") continue;
      const v = Number(raw);
      if (Number.isNaN(v)) continue;
      if (!out[field]) out[field] = [];
      out[field]!.push({ t: time, v });
    }
  }

  for (const field of HISTORY_FIELDS) {
    out[field]?.sort((a, b) => a.t.localeCompare(b.t));
  }
  return out;
}

export async function queryAgentMetricsHistory(
  agentId: string,
  range: MetricHistoryRange = "1h",
): Promise<AgentMetricHistory | null> {
  const cfg = resolveInfluxConfig();
  if (!cfg) return null;

  const safeId = agentId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const fieldFilter = HISTORY_FIELDS.map((f) => `r._field == "${f}"`).join(" or ");
  const flux = `from(bucket: "${cfg.bucket}")
  |> range(start: -${range})
  |> filter(fn: (r) => r._measurement == "host_metrics" and r.agent_id == "${safeId}")
  |> filter(fn: (r) => ${fieldFilter})
  |> aggregateWindow(every: 30s, fn: mean, createEmpty: false)
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")`;

  const res = await fetch(
    `${cfg.url}/api/v2/query?org=${encodeURIComponent(cfg.org)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${cfg.token}`,
        "Content-Type": "application/vnd.flux",
        Accept: "application/csv",
      },
      body: flux,
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`influx query failed ${res.status}: ${text.slice(0, 300)}`);
  }
  const csv = await res.text();
  return parseInfluxPivotCsv(csv);
}

export function grafanaAgentDashboardUrl(
  agentId: string,
  hostname: string,
): string {
  const base = grafanaPublicUrl().replace(/\/$/, "");
  const params = new URLSearchParams({
    "var-agent_id": agentId,
    "var-hostname": hostname,
  });
  return `${base}/d/fleet-host-metrics/fleet-host-metrics?${params.toString()}`;
}
