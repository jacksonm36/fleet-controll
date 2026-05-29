"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import { apiFetch } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { useSession } from "@/lib/useSession";

type ObsConfig = {
  influxConfigured: boolean;
  grafanaUrl: string;
  lokiUrl: string;
  metricsIntervalSec: number;
};

type MonitoringDashboard = {
  config: ObsConfig;
  hosts: HostMetrics[];
};

const MONITORING_CACHE_KEY = "fleet-monitoring-dashboard-v1";

function readMonitoringCache(): MonitoringDashboard | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(MONITORING_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MonitoringDashboard;
  } catch {
    return null;
  }
}

function writeMonitoringCache(data: MonitoringDashboard) {
  try {
    sessionStorage.setItem(MONITORING_CACHE_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota */
  }
}

type HostMetrics = {
  id: string;
  hostname: string;
  osType: string;
  online: boolean;
  metricsStale: boolean;
  lastSeenAt: string | null;
  lastMetricsAt: string | null;
  cpuPercent: number | null;
  memUsedPercent: number | null;
  load1: number | null;
  networkRxBps: number | null;
  networkTxBps: number | null;
  diskRootUsedPercent: number | null;
  loggedInUsers: number | null;
  healthScore: number | null;
  healthStatus: string | null;
  rebootRequired: boolean;
  packageUpdatesPending: number;
  cveCount: number;
};

function fmtBps(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} MB/s`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)} KB/s`;
  return `${Math.round(v)} B/s`;
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString();
}

function healthClass(status: string | null): string {
  switch (status) {
    case "healthy":
      return "text-emerald-400 bg-emerald-500/15";
    case "degraded":
      return "text-amber-300 bg-amber-500/15";
    case "critical":
      return "text-red-400 bg-red-500/15";
    default:
      return "text-white/50 bg-white/10";
  }
}

function barColor(pct: number | null): string {
  if (pct == null) return "bg-white/20";
  if (pct >= 90) return "bg-red-500";
  if (pct >= 75) return "bg-amber-400";
  return "bg-emerald-500";
}

function MetricBar({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const pct = value ?? 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-white/50">{label}</span>
        <span>{fmtPct(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full transition-all duration-500 ${barColor(value)}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}

export default function MonitoringPage() {
  const { hydrated, checked, authed } = useSession();
  const cached = useMemo(() => readMonitoringCache(), []);
  const [config, setConfig] = useState<ObsConfig | null>(cached?.config ?? null);
  const [hosts, setHosts] = useState<HostMetrics[]>(cached?.hosts ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await apiFetch<MonitoringDashboard>(
        "/api/observability/dashboard",
        { cacheTtlMs: 3_000 },
      );
      setConfig(data.config);
      setHosts(data.hosts);
      writeMonitoringCache(data);
      setLastRefresh(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load monitoring data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hydrated || !authed) return;
    if (!cached) setLoading(true);
    void reload();
  }, [hydrated, authed, reload, cached]);

  usePolling(() => {
    if (!hydrated || !authed) return;
    void reload();
  }, 8_000, false);

  const summary = useMemo(() => {
    const online = hosts.filter((h) => h.online).length;
    const live = hosts.filter((h) => h.online && !h.metricsStale).length;
    const withMetrics = hosts.filter((h) => h.lastMetricsAt != null);
    const avg = (fn: (h: HostMetrics) => number | null) => {
      const vals = withMetrics
        .map(fn)
        .filter((v): v is number => v != null);
      if (!vals.length) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    const healthy = hosts.filter((h) => h.healthStatus === "healthy").length;
    const degraded = hosts.filter((h) => h.healthStatus === "degraded").length;
    const critical = hosts.filter((h) => h.healthStatus === "critical").length;
    const totalRx = withMetrics.reduce((s, h) => s + (h.networkRxBps ?? 0), 0);
    const totalTx = withMetrics.reduce((s, h) => s + (h.networkTxBps ?? 0), 0);
    const totalUsers = withMetrics.reduce((s, h) => s + (h.loggedInUsers ?? 0), 0);
    return {
      total: hosts.length,
      online,
      live,
      avgCpu: avg((h) => h.cpuPercent),
      avgMem: avg((h) => h.memUsedPercent),
      avgDisk: avg((h) => h.diskRootUsedPercent),
      avgHealth: avg((h) => h.healthScore),
      healthy,
      degraded,
      critical,
      totalRx,
      totalTx,
      totalUsers,
    };
  }, [hosts]);

  if (!hydrated || !checked) return <AuthLoadingShell />;
  if (!authed) return null;

  return (
    <Shell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-white/50">
              InfluxDB · Loki · Grafana
            </div>
            <h1 className="text-2xl font-semibold">Monitoring</h1>
            <p className="mt-1 max-w-2xl text-sm text-white/60">
              Live host metrics from enrolled agents (every{" "}
              {config?.metricsIntervalSec ?? 30}s). Historical charts and logs in
              Grafana / Loki.
              {lastRefresh ? (
                <span className="text-white/40">
                  {" "}
                  · Updated {lastRefresh.toLocaleTimeString()}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void reload()}
              className="rounded-md border border-white/20 px-3 py-2 text-xs hover:bg-white/10"
            >
              Refresh now
            </button>
            {config?.grafanaUrl ? (
              <a
                href={config.grafanaUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
              >
                Grafana dashboards ↗
              </a>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        {hosts.some((h) => h.online && h.metricsStale) ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            <p className="font-medium text-amber-200">Agents online but not sending metrics</p>
            <p className="mt-1 text-white/70">
              The host is heartbeating but has never reported metrics (or the binary is too
              old). On each agent machine, install the latest binary and restart the service:
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-3 text-xs text-white/90">
              {`curl -kfsSL '${typeof window !== "undefined" ? window.location.origin : "https://YOUR_CONTROLLER"}/api/public/agent-install-prebuilt.sh' | bash`}
            </pre>
            <p className="mt-2 text-xs text-white/50">
              Or from the repo:{" "}
              <code className="text-white/70">bash scripts/upgrade-fleet-agent-binary.sh</code>
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <SummaryCard label="Agents" value={String(summary.total)} sub={`${summary.online} online`} />
          <SummaryCard
            label="Live metrics"
            value={String(summary.live)}
            sub={`of ${summary.total} reporting`}
            accent={summary.live > 0 ? "emerald" : "amber"}
          />
          <SummaryCard label="Avg CPU" value={fmtPct(summary.avgCpu)} />
          <SummaryCard label="Avg RAM" value={fmtPct(summary.avgMem)} />
          <SummaryCard label="Fleet RX" value={fmtBps(summary.totalRx)} sub="aggregate" />
          <SummaryCard label="Fleet TX" value={fmtBps(summary.totalTx)} sub="aggregate" />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <StackCard
            name="InfluxDB"
            ok={config?.influxConfigured ?? false}
            url="http://127.0.0.1:8086"
            detail="Time-series metrics"
          />
          <StackCard
            name="Grafana"
            ok={!!config?.grafanaUrl}
            url={config?.grafanaUrl ?? "—"}
            detail="Charts & dashboards"
            link={config?.grafanaUrl}
          />
          <StackCard
            name="Loki"
            ok={!!config?.lokiUrl}
            url={config?.lokiUrl ?? "—"}
            detail="Agent & service logs"
          />
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <HealthPill count={summary.healthy} label="healthy" className="text-emerald-400" />
          <HealthPill count={summary.degraded} label="degraded" className="text-amber-300" />
          <HealthPill count={summary.critical} label="critical" className="text-red-400" />
          <span className="text-white/40">· {summary.totalUsers} logged-in users fleet-wide</span>
        </div>

        {loading && hosts.length === 0 ? (
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center text-sm text-white/50">
            Loading monitoring data…
          </div>
        ) : hosts.length === 0 ? (
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center text-sm text-white/50">
            No agents enrolled. Enroll a host and ensure the agent is running to see
            metrics here.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {hosts.map((h) => (
              <HostCard key={h.id} host={h} />
            ))}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          <div className="border-b border-white/10 px-3 py-2 text-xs uppercase text-white/50">
            All hosts — tabular view
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse text-sm">
              <thead className="bg-white/5 text-left text-xs uppercase text-white/50">
                <tr>
                  <th className="px-3 py-2">Host</th>
                  <th className="px-3 py-2">Stream</th>
                  <th className="px-3 py-2">CPU</th>
                  <th className="px-3 py-2">RAM</th>
                  <th className="px-3 py-2">Network</th>
                  <th className="px-3 py-2">Users</th>
                  <th className="px-3 py-2">Health</th>
                  <th className="px-3 py-2">Load</th>
                  <th className="px-3 py-2">Disk</th>
                  <th className="px-3 py-2">Last metric</th>
                </tr>
              </thead>
              <tbody>
                {hosts.map((h) => (
                  <tr key={h.id} className="border-t border-white/5">
                    <td className="px-3 py-2">
                      <Link
                        href={`/monitoring/${h.id}`}
                        className="font-medium text-[hsl(var(--accent))] hover:underline"
                      >
                        {h.hostname}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {!h.online ? (
                        <span className="text-white/40">offline</span>
                      ) : h.metricsStale ? (
                        <span className="text-amber-300">stale</span>
                      ) : (
                        <span className="text-emerald-400">live</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{fmtPct(h.cpuPercent)}</td>
                    <td className="px-3 py-2">{fmtPct(h.memUsedPercent)}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      ↓ {fmtBps(h.networkRxBps)} · ↑ {fmtBps(h.networkTxBps)}
                    </td>
                    <td className="px-3 py-2">{h.loggedInUsers ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${healthClass(h.healthStatus)}`}
                      >
                        {h.healthScore ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {h.load1 != null ? h.load1.toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {h.diskRootUsedPercent != null
                        ? `${h.diskRootUsedPercent.toFixed(0)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-white/50">
                      {fmtTime(h.lastMetricsAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "emerald" | "amber";
}) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <div className="text-xs uppercase text-white/50">{label}</div>
      <div
        className={`mt-1 text-xl font-semibold ${
          accent === "emerald"
            ? "text-emerald-400"
            : accent === "amber"
              ? "text-amber-300"
              : ""
        }`}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-white/40">{sub}</div> : null}
    </div>
  );
}

function StackCard({
  name,
  ok,
  url,
  detail,
  link,
}: {
  name: string;
  ok: boolean;
  url: string;
  detail: string;
  link?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase text-white/50">{name}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
            ok ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-300"
          }`}
        >
          {ok ? "ok" : "check"}
        </span>
      </div>
      <div className="mt-1 truncate text-sm text-white/80">{url}</div>
      <div className="mt-0.5 text-xs text-white/40">{detail}</div>
    </>
  );
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" className="block hover:opacity-90">
          {inner}
        </a>
      ) : (
        inner
      )}
    </div>
  );
}

function HealthPill({
  count,
  label,
  className,
}: {
  count: number;
  label: string;
  className: string;
}) {
  if (count === 0) return null;
  return (
    <span className={`rounded-full bg-white/5 px-2 py-1 ${className}`}>
      {count} {label}
    </span>
  );
}

function HostCard({ host: h }: { host: HostMetrics }) {
  return (
    <Link
      href={`/monitoring/${h.id}`}
      className="block rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 transition hover:border-[hsl(var(--accent))]/40 hover:bg-white/[0.02]"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-[hsl(var(--accent))]">{h.hostname}</div>
          <div className="text-xs text-white/40">
            {h.osType}
            {h.lastMetricsAt ? ` · metrics ${fmtTime(h.lastMetricsAt)}` : ""}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase ${healthClass(h.healthStatus)}`}
        >
          {h.healthStatus ?? "unknown"}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        <MetricBar label="CPU" value={h.cpuPercent} />
        <MetricBar label="Memory" value={h.memUsedPercent} />
        <MetricBar label="Disk /" value={h.diskRootUsedPercent} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div>
          <dt className="text-white/40">Network ↓</dt>
          <dd>{fmtBps(h.networkRxBps)}</dd>
        </div>
        <div>
          <dt className="text-white/40">Network ↑</dt>
          <dd>{fmtBps(h.networkTxBps)}</dd>
        </div>
        <div>
          <dt className="text-white/40">Load (1m)</dt>
          <dd>{h.load1 != null ? h.load1.toFixed(2) : "—"}</dd>
        </div>
        <div>
          <dt className="text-white/40">Users</dt>
          <dd>{h.loggedInUsers ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-white/40">Health</dt>
          <dd>{h.healthScore ?? "—"} / 100</dd>
        </div>
        <div>
          <dt className="text-white/40">Stream</dt>
          <dd>
            {!h.online ? (
              <span className="text-white/40">offline</span>
            ) : h.metricsStale ? (
              <span className="text-amber-300">stale</span>
            ) : (
              <span className="text-emerald-400">live</span>
            )}
          </dd>
        </div>
      </dl>

      {(h.rebootRequired || h.packageUpdatesPending > 0 || h.cveCount > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
          {h.rebootRequired ? (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300">
              reboot pending
            </span>
          ) : null}
          {h.packageUpdatesPending > 0 ? (
            <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-sky-300">
              {h.packageUpdatesPending} updates
            </span>
          ) : null}
          {h.cveCount > 0 ? (
            <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-red-300">
              {h.cveCount} CVEs
            </span>
          ) : null}
        </div>
      )}
    </Link>
  );
}
