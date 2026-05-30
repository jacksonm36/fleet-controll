"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import {
  AgentMonitoringTabs,
  type MonitoringTab,
} from "@/components/AgentMonitoringTabs";
import { AgentLogsPanel } from "@/components/AgentLogsPanel";
import { JobLogs } from "@/components/JobLogs";
import type { AgentMetricHistory } from "@/components/AgentMetricCharts";
import { apiFetch } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { useSession } from "@/lib/useSession";
import { OsInfo } from "@/components/OsInfo";

type HostMetrics = {
  id: string;
  hostname: string;
  osType: string;
  primaryIp?: string | null;
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

type AgentContext = {
  agent: {
    id: string;
    hostname: string;
    osType: string;
    osDetail: string | null;
    primaryIp?: string | null;
    version: string | null;
    status: string;
    enrolledAt: string;
    lastSeenAt: string | null;
    online: boolean;
    metricsStale: boolean;
    rebootRequired: boolean;
    crowdsecInstalled: boolean;
    kernelRunning: string | null;
    kernelInstalled: string | null;
    kernelUpdatePending: boolean;
    packageUpdatesPending: number;
    cveCount: number;
    cveCriticalCount: number;
    cveHighCount: number;
    lastCveScanAt: string | null;
    cpuPercent: number | null;
    memUsedPercent: number | null;
    healthScore: number | null;
    healthStatus: string | null;
  };
  counts: {
    packages: number;
    services: number;
    containers: number;
    jobs: number;
    cveFindings: number;
    patchPlans: number;
    outdatedPackages: number;
  };
  recentJobs: Array<{
    id: string;
    type: string;
    status: string;
    createdAt: string;
    finishedAt: string | null;
    errorMessage: string | null;
  }>;
  recentPatchRuns: Array<{
    id: string;
    manager: string;
    packageCount: number;
    exitStatus: string;
    startedAt: string;
    finishedAt: string | null;
  }>;
  topCves: Array<{
    id: string;
    cveId: string;
    severity: string;
    packageName: string | null;
    summary: string | null;
  }>;
  failedServices: Array<{
    name: string;
    kind: string;
    state: string;
    enabled: boolean | null;
  }>;
  runningContainers: Array<{
    name: string;
    image: string;
    runtime: string;
    status: string;
  }>;
};

type AgentMonitoringDetail = {
  config: {
    metricsIntervalSec: number;
    grafanaUrl: string;
    influxConfigured: boolean;
    lokiConfigured: boolean;
  };
  host: HostMetrics;
  context: AgentContext;
  range: "1h" | "6h" | "24h";
  history: AgentMetricHistory;
  historyAvailable: boolean;
  historyError: string | null;
  grafanaAgentUrl: string;
  grafanaLogsUrl: string;
};

const AgentMetricCharts = dynamic(
  () =>
    import("@/components/AgentMetricCharts").then((m) => m.AgentMetricCharts),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-4 lg:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-60 animate-pulse rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
          />
        ))}
      </div>
    ),
  },
);

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
  return d.toLocaleString();
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

function severityClass(s: string): string {
  switch (s) {
    case "CRITICAL":
      return "text-red-400";
    case "HIGH":
      return "text-orange-400";
    case "MEDIUM":
      return "text-amber-300";
    default:
      return "text-white/50";
  }
}

const RANGES = [
  { id: "1h" as const, label: "1 hour" },
  { id: "6h" as const, label: "6 hours" },
  { id: "24h" as const, label: "24 hours" },
];

const TAB_IDS = new Set<MonitoringTab>([
  "overview",
  "metrics",
  "logs",
  "activity",
  "security",
]);

export default function AgentMonitoringPage() {
  return (
    <Suspense fallback={<AuthLoadingShell />}>
      <AgentMonitoringPageInner />
    </Suspense>
  );
}

function AgentMonitoringPageInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const agentId = typeof params.id === "string" ? params.id : "";
  const tabParam = searchParams.get("tab");
  const initialTab: MonitoringTab = TAB_IDS.has(tabParam as MonitoringTab)
    ? (tabParam as MonitoringTab)
    : "overview";

  const { hydrated, checked, authed } = useSession();
  const [tab, setTab] = useState<MonitoringTab>(initialTab);
  const [range, setRange] = useState<"1h" | "6h" | "24h">("1h");
  const [data, setData] = useState<AgentMonitoringDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [jobLogsId, setJobLogsId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!agentId) return;
    try {
      const detail = await apiFetch<AgentMonitoringDetail>(
        `/api/observability/agents/${encodeURIComponent(agentId)}?range=${range}`,
        { cacheTtlMs: 3_000 },
      );
      setData(detail);
      setLastRefresh(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agent metrics");
    } finally {
      setLoading(false);
    }
  }, [agentId, range]);

  useEffect(() => {
    if (TAB_IDS.has(tabParam as MonitoringTab)) {
      setTab(tabParam as MonitoringTab);
    }
  }, [tabParam]);

  useEffect(() => {
    if (!hydrated || !authed || !agentId) return;
    setLoading(true);
    void reload();
  }, [hydrated, authed, agentId, reload]);

  usePolling(() => {
    if (!hydrated || !authed || !agentId) return;
    void reload();
  }, 5_000, false);

  const badges = useMemo(
    () => ({
      security: data?.context.agent.cveCount ?? 0,
      activity: data?.context.recentJobs.length ?? 0,
    }),
    [data],
  );

  if (!hydrated || !checked) return <AuthLoadingShell />;
  if (!authed) return null;

  const h = data?.host;
  const ctx = data?.context;

  return (
    <Shell>
      <JobLogs
        jobId={jobLogsId}
        open={!!jobLogsId}
        onClose={() => setJobLogsId(null)}
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/monitoring"
              className="text-xs text-[hsl(var(--accent))] hover:underline"
            >
              ← Fleet monitoring
            </Link>
            <h1 className="mt-1 text-2xl font-semibold">
              {h ? (
                <Link
                  href={`/agents/${h.id}`}
                  className="text-[hsl(var(--accent))] hover:underline"
                >
                  {h.hostname}
                </Link>
              ) : (
                "Agent metrics"
              )}
            </h1>
            <p className="mt-1 text-sm text-white/60">
              Metrics, logs, jobs, and security for this host.
              {lastRefresh ? (
                <span className="text-white/40">
                  {" "}
                  · Updated {lastRefresh.toLocaleTimeString()}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(tab === "metrics" || tab === "logs") && (
              <div className="flex rounded-md border border-white/20 p-0.5 text-xs">
                {RANGES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRange(r.id)}
                    className={`rounded px-2.5 py-1.5 ${
                      range === r.id
                        ? "bg-[hsl(var(--accent))] font-semibold text-black"
                        : "text-white/70 hover:bg-white/10"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => void reload()}
              className="rounded-md border border-white/20 px-3 py-2 text-xs hover:bg-white/10"
            >
              Refresh
            </button>
            {data?.grafanaAgentUrl ? (
              <a
                href={data.grafanaAgentUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-white/20 px-3 py-2 text-xs hover:bg-white/10"
              >
                Grafana metrics ↗
              </a>
            ) : null}
            {data?.grafanaLogsUrl ? (
              <a
                href={data.grafanaLogsUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-white/20 px-3 py-2 text-xs hover:bg-white/10"
              >
                Grafana logs ↗
              </a>
            ) : null}
            {h ? (
              <Link
                href={`/agents/${h.id}`}
                className="rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
              >
                Full agent page
              </Link>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        {loading && !h ? (
          <div className="text-sm text-white/50">Loading…</div>
        ) : h && ctx ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              <Stat
                label="Stream"
                value={
                  h.online && !h.metricsStale
                    ? "live"
                    : h.online
                      ? "stale"
                      : "offline"
                }
              />
              <Stat label="CPU" value={fmtPct(h.cpuPercent)} />
              <Stat label="RAM" value={fmtPct(h.memUsedPercent)} />
              <Stat label="Disk /" value={fmtPct(h.diskRootUsedPercent)} />
              <Stat
                label="Network"
                value={`↓ ${fmtBps(h.networkRxBps)} · ↑ ${fmtBps(h.networkTxBps)}`}
              />
              <Stat label="Health" value={`${h.healthScore ?? "—"} / 100`} />
            </div>

            <AgentMonitoringTabs
              active={tab}
              onChange={setTab}
              badges={badges}
            />

            <div className="rounded-b-lg rounded-tr-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-5">
              {tab === "overview" && (
                <OverviewPanel
                  host={h}
                  ctx={ctx}
                  metricsIntervalSec={data?.config.metricsIntervalSec ?? 5}
                  onOpenMetrics={() => setTab("metrics")}
                  onOpenLogs={() => setTab("logs")}
                />
              )}
              {tab === "metrics" && (
                <MetricsPanel data={data} range={range} />
              )}
              {tab === "logs" && (
                <AgentLogsPanel
                  agentId={agentId}
                  hostname={h.hostname}
                  range={range}
                />
              )}
              {tab === "activity" && (
                <ActivityPanel
                  ctx={ctx}
                  onViewJobLogs={setJobLogsId}
                />
              )}
              {tab === "security" && <SecurityPanel ctx={ctx} agentId={h.id} />}
            </div>
          </>
        ) : null}
      </div>
    </Shell>
  );
}

function streamLabel(h: HostMetrics): string {
  if (!h.online) return "offline";
  if (h.metricsStale) return "stale (no recent metrics)";
  return "live";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <div className="text-xs uppercase text-white/50">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function OverviewPanel({
  host: h,
  ctx,
  metricsIntervalSec,
  onOpenMetrics,
  onOpenLogs,
}: {
  host: HostMetrics;
  ctx: AgentContext;
  metricsIntervalSec: number;
  onOpenMetrics: () => void;
  onOpenLogs: () => void;
}) {
  const a = ctx.agent;
  return (
    <div className="space-y-5">
      <Section title="Live metrics (agent snapshot)">
        <p className="mb-3 text-xs text-white/50">
          Collected every ~{metricsIntervalSec}s from the agent (CPU, memory, disk,
          network, load, users, health). Historical charts are on the Metrics tab.
        </p>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <Info label="Stream" value={streamLabel(h)} />
          <Info label="CPU" value={fmtPct(h.cpuPercent)} />
          <Info label="Memory" value={fmtPct(h.memUsedPercent)} />
          <Info label="Disk /" value={fmtPct(h.diskRootUsedPercent)} />
          <Info
            label="Network"
            value={`↓ ${fmtBps(h.networkRxBps)} · ↑ ${fmtBps(h.networkTxBps)}`}
          />
          <Info label="Load (1m)" value={h.load1 != null ? h.load1.toFixed(2) : "—"} />
          <Info label="Logged-in users" value={String(h.loggedInUsers ?? "—")} />
          <Info
            label="Health"
            value={`${h.healthScore ?? "—"} / 100 (${h.healthStatus ?? "unknown"})`}
          />
          <Info label="Primary IP" value={h.primaryIp ?? a.primaryIp ?? "—"} />
          <Info label="Last metrics" value={fmtTime(h.lastMetricsAt)} />
          <Info label="Last seen" value={fmtTime(h.lastSeenAt)} />
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenMetrics}
            className="rounded-md border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
          >
            Metrics charts →
          </button>
          <button
            type="button"
            onClick={onOpenLogs}
            className="rounded-md border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
          >
            Host logs →
          </button>
        </div>
      </Section>

      <Section title="Host identity">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <Info label="Hostname" value={a.hostname} />
          <div>
            <dt className="text-xs text-white/40">OS</dt>
            <dd className="mt-0.5">
              <OsInfo osType={a.osType} osDetail={a.osDetail} />
            </dd>
          </div>
          <Info label="Agent version" value={a.version ?? "—"} />
          <Info label="Status" value={a.status} />
          <Info label="Enrolled" value={fmtTime(a.enrolledAt)} />
          <Info label="Last seen" value={fmtTime(a.lastSeenAt)} />
          <Info label="Last metrics" value={fmtTime(h.lastMetricsAt)} />
          <Info
            label="Kernel"
            value={
              a.kernelRunning
                ? `${a.kernelRunning}${a.kernelUpdatePending ? " (update pending)" : ""}`
                : "—"
            }
          />
          <Info
            label="CrowdSec"
            value={a.crowdsecInstalled ? "installed" : "not detected"}
          />
        </dl>
      </Section>

      <Section title="Inventory snapshot">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <CountCard label="Packages" value={ctx.counts.packages} sub={`${ctx.counts.outdatedPackages} outdated`} />
          <CountCard
            label="Services"
            value={ctx.counts.services}
            sub={
              ctx.failedServices.length > 0
                ? `${ctx.failedServices.length} need attention`
                : "all healthy"
            }
          />
          <CountCard label="Containers" value={ctx.counts.containers} />
          <CountCard label="Jobs" value={ctx.counts.jobs} />
          <CountCard label="Patch plans" value={ctx.counts.patchPlans} />
          <CountCard label="CVE findings" value={ctx.counts.cveFindings} accent={ctx.counts.cveFindings > 0 ? "red" : undefined} />
        </div>
      </Section>

      {ctx.failedServices.length > 0 ? (
        <Section title="Services needing attention">
          <ul className="space-y-1 text-sm">
            {ctx.failedServices.map((s) => (
              <li key={s.name} className="flex justify-between gap-2 rounded bg-white/5 px-2 py-1">
                <span>{s.name}</span>
                <span className="text-amber-300">{s.state}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {ctx.runningContainers.length > 0 ? (
        <Section title="Containers">
          <ul className="space-y-1 text-sm">
            {ctx.runningContainers.map((c) => (
              <li key={c.name} className="rounded bg-white/5 px-2 py-1.5">
                <div className="font-medium">{c.name}</div>
                <div className="truncate text-xs text-white/45">
                  {c.image} · {c.runtime} · {c.status}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {a.rebootRequired ? (
          <Badge tone="amber">Reboot required</Badge>
        ) : null}
        {a.packageUpdatesPending > 0 ? (
          <Badge tone="sky">{a.packageUpdatesPending} package updates</Badge>
        ) : null}
        {a.kernelUpdatePending ? (
          <Badge tone="amber">Kernel update pending</Badge>
        ) : null}
        <span
          className={`rounded-full px-2 py-0.5 text-xs uppercase ${healthClass(a.healthStatus)}`}
        >
          {a.healthStatus ?? "unknown"}
        </span>
      </div>
    </div>
  );
}

function MetricsPanel({
  data,
}: {
  data: AgentMonitoringDetail;
  range: string;
}) {
  return (
    <div className="space-y-4">
      {data.historyError ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          History unavailable: {data.historyError}
        </div>
      ) : null}
      {!data.historyAvailable && !data.historyError ? (
        <div className="text-sm text-white/50">
          Collecting history — charts appear after a few minutes of metrics at{" "}
          {data.config.metricsIntervalSec}s intervals.
        </div>
      ) : null}
      <AgentMetricCharts history={data.history} />
    </div>
  );
}

function ActivityPanel({
  ctx,
  onViewJobLogs,
}: {
  ctx: AgentContext;
  onViewJobLogs: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      <Section title="Recent jobs">
        {ctx.recentJobs.length === 0 ? (
          <p className="text-sm text-white/45">No jobs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-white/45">
                <tr>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ctx.recentJobs.map((j) => (
                  <tr key={j.id} className="border-t border-white/5">
                    <td className="py-2 pr-3 font-mono text-xs">{j.type}</td>
                    <td className="py-2 pr-3">
                      <JobStatus status={j.status} />
                    </td>
                    <td className="py-2 pr-3 text-xs text-white/50">
                      {fmtTime(j.createdAt)}
                      {j.errorMessage ? (
                        <div className="mt-0.5 truncate text-red-300/80" title={j.errorMessage}>
                          {j.errorMessage}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => onViewJobLogs(j.id)}
                        className="text-xs text-[hsl(var(--accent))] hover:underline"
                      >
                        View logs
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Patch runs">
        {ctx.recentPatchRuns.length === 0 ? (
          <p className="text-sm text-white/45">No patch runs recorded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {ctx.recentPatchRuns.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded bg-white/5 px-3 py-2"
              >
                <span>
                  {r.manager} · {r.packageCount} packages
                </span>
                <span
                  className={
                    r.exitStatus === "success"
                      ? "text-emerald-400"
                      : "text-red-400"
                  }
                >
                  {r.exitStatus}
                </span>
                <span className="text-xs text-white/40">
                  {fmtTime(r.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/patches"
          className="mt-2 inline-block text-xs text-[hsl(var(--accent))] hover:underline"
        >
          Fleet patch history →
        </Link>
      </Section>
    </div>
  );
}

function SecurityPanel({
  ctx,
  agentId,
}: {
  ctx: AgentContext;
  agentId: string;
}) {
  const a = ctx.agent;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-sm">
        <div>
          <span className="text-white/45">Total CVEs</span>
          <div className="text-xl font-semibold text-red-400">{a.cveCount}</div>
        </div>
        <div>
          <span className="text-white/45">Critical</span>
          <div className="text-xl font-semibold">{a.cveCriticalCount}</div>
        </div>
        <div>
          <span className="text-white/45">High</span>
          <div className="text-xl font-semibold">{a.cveHighCount}</div>
        </div>
        <div>
          <span className="text-white/45">Last scan</span>
          <div className="text-sm">{fmtTime(a.lastCveScanAt)}</div>
        </div>
      </div>

      {ctx.topCves.length === 0 ? (
        <p className="text-sm text-white/45">No CVE findings in inventory.</p>
      ) : (
        <ul className="space-y-2">
          {ctx.topCves.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-mono font-medium ${severityClass(c.severity)}`}>
                  {c.cveId}
                </span>
                <span className="text-xs uppercase text-white/40">{c.severity}</span>
                {c.packageName ? (
                  <span className="text-xs text-white/50">{c.packageName}</span>
                ) : null}
              </div>
              {c.summary ? (
                <p className="mt-1 text-xs text-white/55 line-clamp-2">{c.summary}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Link
        href={`/agents/${agentId}`}
        className="inline-block text-sm text-[hsl(var(--accent))] hover:underline"
      >
        Full CVE & package inventory on agent page →
      </Link>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/45">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-white/40">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function CountCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number;
  sub?: string;
  accent?: "red";
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="text-xs text-white/45">{label}</div>
      <div
        className={`text-2xl font-semibold ${accent === "red" ? "text-red-400" : ""}`}
      >
        {value}
      </div>
      {sub ? <div className="text-xs text-white/40">{sub}</div> : null}
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "amber" | "sky" | "red";
}) {
  const cls =
    tone === "amber"
      ? "bg-amber-500/20 text-amber-300"
      : tone === "sky"
        ? "bg-sky-500/20 text-sky-300"
        : "bg-red-500/20 text-red-300";
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>{children}</span>
  );
}

function JobStatus({ status }: { status: string }) {
  const cls =
    status === "COMPLETED"
      ? "text-emerald-400"
      : status === "FAILED"
        ? "text-red-400"
        : status === "RUNNING"
          ? "text-sky-400"
          : "text-white/50";
  return <span className={cls}>{status}</span>;
}
