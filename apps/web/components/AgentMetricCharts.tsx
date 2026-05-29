"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type MetricHistoryPoint = { t: string; v: number };

export type AgentMetricHistory = Partial<
  Record<
    | "cpu_percent"
    | "mem_used_percent"
    | "network_rx_bps"
    | "network_tx_bps"
    | "disk_root_used_percent"
    | "load1"
    | "logged_in_users"
    | "health_score",
    MetricHistoryPoint[]
  >
>;

function mergeHistory(history: AgentMetricHistory) {
  const byTime = new Map<string, Record<string, string | number>>();
  for (const [field, points] of Object.entries(history)) {
    if (!points?.length) continue;
    for (const { t, v } of points) {
      const row = byTime.get(t) ?? { t };
      row[field] = v;
      byTime.set(t, row);
    }
  }
  return [...byTime.values()].sort((a, b) =>
    String(a.t).localeCompare(String(b.t)),
  );
}

function fmtTimeLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const tooltipStyle = {
  background: "#0f172a",
  borderColor: "#334155",
  color: "#e2e8f0",
};

function MetricChart({
  title,
  data,
  lines,
  yDomain,
  unit,
}: {
  title: string;
  data: Record<string, string | number>[];
  lines: { key: string; name: string; color: string }[];
  yDomain?: [number, number];
  unit?: string;
}) {
  if (!data.length) {
    return (
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
        <div className="text-sm font-medium text-white/80">{title}</div>
        <p className="mt-4 text-xs text-white/40">No history yet — wait for agent samples.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <div className="mb-2 text-sm font-medium text-white/80">{title}</div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="t"
              stroke="#94a3b8"
              tickFormatter={fmtTimeLabel}
              minTickGap={32}
            />
            <YAxis stroke="#94a3b8" domain={yDomain} unit={unit} />
            <Tooltip
              labelFormatter={fmtTimeLabel}
              contentStyle={tooltipStyle}
            />
            <Legend />
            {lines.map((l) => (
              <Line
                key={l.key}
                type="monotone"
                dataKey={l.key}
                name={l.name}
                stroke={l.color}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function AgentMetricCharts({ history }: { history: AgentMetricHistory }) {
  const merged = mergeHistory(history);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <MetricChart
        title="CPU %"
        data={merged}
        lines={[{ key: "cpu_percent", name: "CPU", color: "#38bdf8" }]}
        yDomain={[0, 100]}
        unit="%"
      />
      <MetricChart
        title="Memory %"
        data={merged}
        lines={[{ key: "mem_used_percent", name: "RAM", color: "#a78bfa" }]}
        yDomain={[0, 100]}
        unit="%"
      />
      <MetricChart
        title="Network throughput"
        data={merged}
        lines={[
          { key: "network_rx_bps", name: "RX", color: "#34d399" },
          { key: "network_tx_bps", name: "TX", color: "#fbbf24" },
        ]}
      />
      <MetricChart
        title="Disk / usage %"
        data={merged}
        lines={[
          { key: "disk_root_used_percent", name: "Disk /", color: "#fb923c" },
        ]}
        yDomain={[0, 100]}
        unit="%"
      />
      <MetricChart
        title="Load (1m)"
        data={merged}
        lines={[{ key: "load1", name: "Load", color: "#f472b6" }]}
      />
      <MetricChart
        title="Health score"
        data={merged}
        lines={[{ key: "health_score", name: "Health", color: "#4ade80" }]}
        yDomain={[0, 100]}
      />
      <MetricChart
        title="Logged-in users"
        data={merged}
        lines={[{ key: "logged_in_users", name: "Users", color: "#94a3b8" }]}
      />
    </div>
  );
}
