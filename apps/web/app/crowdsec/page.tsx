"use client";

import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import { OsInfo } from "@/components/OsInfo";
import { apiFetch } from "@/lib/api";
import {
  actionBadgeClass,
  agentPostureLabel,
  formatCrowdSecTime,
  type CrowdSecAgentsResponse,
  type CrowdSecAlertRow,
  type CrowdSecDecisionRow,
  type CrowdSecStatus,
} from "@/lib/crowdsec";
import { usePolling } from "@/lib/usePolling";
import { useSession } from "@/lib/useSession";

type ViewTab = "agents" | "alerts" | "decisions";

export default function CrowdSecPage() {
  const { hydrated, checked, authed } = useSession();
  const [status, setStatus] = useState<CrowdSecStatus | null>(null);
  const [agentsData, setAgentsData] = useState<CrowdSecAgentsResponse | null>(null);
  const [alerts, setAlerts] = useState<CrowdSecAlertRow[]>([]);
  const [decisions, setDecisions] = useState<CrowdSecDecisionRow[]>([]);
  const [tab, setTab] = useState<ViewTab>("agents");
  const [hostFilter, setHostFilter] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const loadCrowdsec = useCallback(async () => {
    if (!authed) return;
    const hostQ = hostFilter.trim()
      ? `?host=${encodeURIComponent(hostFilter.trim())}`
      : "";
    try {
      const [s, ag, a, d] = await Promise.all([
        apiFetch<CrowdSecStatus>("/api/crowdsec/status", { cacheTtlMs: 10_000 }),
        apiFetch<CrowdSecAgentsResponse>("/api/crowdsec/agents", {
          cacheTtlMs: 10_000,
        }),
        apiFetch<CrowdSecAlertRow[]>(`/api/crowdsec/alerts${hostQ}`, {
          cacheTtlMs: 15_000,
        }),
        apiFetch<CrowdSecDecisionRow[]>(`/api/crowdsec/decisions${hostQ}`, {
          cacheTtlMs: 15_000,
        }),
      ]);
      setStatus(s);
      setAgentsData(ag);
      setAlerts(a);
      setDecisions(d);
    } catch {
      /* handled globally */
    }
  }, [authed, hostFilter]);

  useEffect(() => {
    if (!hydrated || !authed) return;
    void loadCrowdsec();
  }, [hydrated, authed, loadCrowdsec]);

  usePolling(() => loadCrowdsec(), 30_000, false);

  const filteredAgents = useMemo(() => {
    const list = agentsData?.agents ?? [];
    const q = hostFilter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) => a.hostname.toLowerCase().includes(q));
  }, [agentsData?.agents, hostFilter]);

  const sortedAgents = useMemo(() => {
    return [...filteredAgents].sort((a, b) => {
      if (a.reporting !== b.reporting) return a.reporting ? -1 : 1;
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.hostname.localeCompare(b.hostname);
    });
  }, [filteredAgents]);

  if (!hydrated || !checked) return <AuthLoadingShell />;
  if (!authed) return null;

  return (
    <Shell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">CrowdSec · federated</h1>
            <p className="text-sm text-white/60">
              Per-agent snapshots from <code className="text-white/70">cscli</code> on
              enrolled hosts — sorted by hostname with parsed alerts and bans.
            </p>
          </div>
          <label className="flex min-w-[200px] flex-col gap-1 text-xs text-white/50">
            Filter by host
            <input
              value={hostFilter}
              onChange={(e) => setHostFilter(e.target.value)}
              placeholder="hostname…"
              className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
          </label>
        </div>

        {status ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Enrolled agents"
                value={status.enrolledAgents}
                hint={`${status.onlineAgents} online`}
              />
              <Metric
                label="Reporting snapshots"
                value={status.reportingAgents}
                hint={`${status.pendingAgents} awaiting data`}
              />
              <Metric
                label="Alerts (cached)"
                value={status.alertTotal}
                hint={`${status.healthyHosts} healthy snapshots`}
              />
              <Metric
                label="Decisions (cached)"
                value={status.decisionTotal}
                hint={`${status.uniqueDecisionValues} unique IPs`}
              />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-red-200">
                {status.banCount} bans
              </span>
              <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-violet-200">
                {status.captchaCount} captchas
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/55">
                Snapshots refresh every ~30s from agents
              </span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-white/60">Loading CrowdSec posture…</div>
        )}

        {agentsData ? (
          <p className="text-xs text-white/45">
            {agentsData.reportingCount} reporting · {agentsData.notReportingCount}{" "}
            without a current snapshot — open <strong>Agents</strong> for per-host
            status and cscli version.
          </p>
        ) : null}

        {tab === "decisions" && decisions.length > 0 ? (
          <DecisionsInsight rows={decisions} />
        ) : null}

        <div className="flex flex-wrap gap-2 border-b border-white/10 pb-2">
          {(
            [
              ["agents", `Agents (${sortedAgents.length})`],
              ["alerts", `Alerts (${alerts.length})`],
              ["decisions", `Decisions (${decisions.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                tab === id
                  ? "bg-[hsl(var(--accent))]/20 text-[hsl(var(--accent))]"
                  : "text-white/60 hover:bg-white/5"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "agents" ? (
          <Section title="Agents">
            <AgentsTable
              rows={sortedAgents}
              onSelectHost={(hostname) => {
                setHostFilter(hostname);
                setTab("alerts");
              }}
            />
          </Section>
        ) : null}

        {tab === "alerts" ? (
          <Section title="Recent alerts">
            <AlertsTable
              rows={alerts}
              expandedKey={expandedKey}
              onToggleExpand={(key) =>
                setExpandedKey((k) => (k === key ? null : key))
              }
            />
          </Section>
        ) : null}

        {tab === "decisions" ? (
          <Section title="Active decisions">
            <DecisionsTable
              rows={decisions}
              expandedKey={expandedKey}
              onToggleExpand={(key) =>
                setExpandedKey((k) => (k === key ? null : key))
              }
            />
          </Section>
        ) : null}
      </div>
    </Shell>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <div className="text-xs uppercase tracking-wide text-white/50">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-white/45">{hint}</div> : null}
    </div>
  );
}

function DecisionsInsight({ rows }: { rows: CrowdSecDecisionRow[] }) {
  const byIp = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.value || r.value === "—") continue;
    const list = byIp.get(r.value) ?? [];
    list.push(r.hostname);
    byIp.set(r.value, list);
  }
  const shared = [...byIp.entries()].filter(([, hosts]) => hosts.length > 1);
  if (!shared.length) return null;
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-100/90">
      <span className="font-medium">Shared decisions:</span>{" "}
      {shared.slice(0, 3).map(([ip, hosts]) => (
        <span key={ip} className="mr-3 inline-block">
          <span className="font-mono text-amber-50">{ip}</span> on{" "}
          {hosts.join(", ")}
        </span>
      ))}
      {shared.length > 3 ? ` (+${shared.length - 3} more IPs)` : null}
    </div>
  );
}

function ExpandPanel({
  open,
  fields,
  raw,
}: {
  open: boolean;
  fields: { label: string; value: string }[];
  raw: Record<string, unknown>;
}) {
  if (!open) return null;
  return (
    <tr className="border-t border-white/5 bg-black/30">
      <td colSpan={99} className="px-3 py-3">
        <dl className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-xs">
          {fields.map((f) => (
            <div key={f.label} className="rounded border border-white/5 bg-white/[0.02] px-2 py-1.5">
              <dt className="text-white/40">{f.label}</dt>
              <dd className="mt-0.5 font-medium text-white/85 break-all">{f.value}</dd>
            </div>
          ))}
        </dl>
        <details>
          <summary className="cursor-pointer text-[11px] text-white/45 hover:text-white/70">
            Raw JSON
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto font-mono text-[11px] text-emerald-100/90">
            {JSON.stringify(raw, null, 2)}
          </pre>
        </details>
      </td>
    </tr>
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
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        {children}
      </div>
    </div>
  );
}

function AgentsTable({
  rows,
  onSelectHost,
}: {
  rows: CrowdSecAgentsResponse["agents"];
  onSelectHost: (hostname: string) => void;
}) {
  if (!rows.length) {
    return (
      <div className="px-4 py-6 text-sm text-white/60">
        No enrolled agents match this filter.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
    <table className="w-full min-w-[880px] border-collapse text-sm">
      <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-white/50">
        <tr>
          <th className="px-3 py-2">Host</th>
          <th className="px-3 py-2">OS</th>
          <th className="px-3 py-2">Agent</th>
          <th className="px-3 py-2">Posture</th>
          <th className="px-3 py-2 text-right">Alerts</th>
          <th className="px-3 py-2 text-right">Decisions</th>
          <th className="px-3 py-2">Snapshot</th>
          <th className="px-3 py-2">Last seen</th>
          <th className="px-3 py-2 text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const posture = agentPostureLabel(row);
          return (
            <tr key={row.agentId} className="border-t border-white/5">
              <td className="px-3 py-2">
                <Link
                  href={`/agents/${row.agentId}?tab=crowdsec`}
                  className="font-medium text-[hsl(var(--accent))] hover:underline"
                >
                  {row.hostname}
                </Link>
                {row.version ? (
                  <div className="text-[11px] text-white/40">{row.version}</div>
                ) : null}
              </td>
              <td className="px-3 py-2">
                <OsInfo
                  osType={row.osType}
                  osDetail={row.osDetail}
                  variant="compact"
                />
              </td>
              <td className="px-3 py-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    row.online ? "bg-emerald-400" : "bg-white/25"
                  }`}
                  title={row.online ? "Online" : "Offline"}
                />
                <span className="ml-2 text-xs text-white/55">
                  {row.online ? "Online" : "Offline"}
                </span>
              </td>
              <td className="px-3 py-2">
                <PostureBadge label={posture.label} tone={posture.tone} />
                {posture.detail ? (
                  <div className="mt-0.5 text-[11px] text-white/40">
                    {posture.detail}
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{row.alertCount}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {row.decisionCount}
              </td>
              <td className="px-3 py-2 text-xs text-white/50 whitespace-nowrap">
                {formatCrowdSecTime(row.capturedAt)}
              </td>
              <td className="px-3 py-2 text-xs text-white/50 whitespace-nowrap">
                {formatCrowdSecTime(row.lastSeenAt)}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onSelectHost(row.hostname)}
                  className="text-xs text-white/60 hover:text-white"
                >
                  View alerts
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function PostureBadge({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "muted" | "offline";
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : tone === "warn"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : tone === "offline"
          ? "border-white/10 bg-white/5 text-white/40"
          : "border-white/10 bg-white/5 text-white/55";
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>
      {label}
    </span>
  );
}

function AlertsTable({
  rows,
  expandedKey,
  onToggleExpand,
}: {
  rows: CrowdSecAlertRow[];
  expandedKey: string | null;
  onToggleExpand: (key: string) => void;
}) {
  if (!rows.length) {
    return (
      <div className="px-4 py-6 text-sm text-white/60">
        No alerts cached — ensure CrowdSec is installed and agents can run{" "}
        <code className="text-white/70">cscli alerts list</code>.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
    <table className="w-full min-w-[960px] border-collapse text-sm">
      <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-white/50">
        <tr>
          <th className="px-3 py-2">Host</th>
          <th className="px-3 py-2">When</th>
          <th className="px-3 py-2">Scenario</th>
          <th className="px-3 py-2">Source IP</th>
          <th className="px-3 py-2">Country</th>
          <th className="px-3 py-2">AS</th>
          <th className="px-3 py-2">Method</th>
          <th className="px-3 py-2">Target</th>
          <th className="px-3 py-2 text-right">Events</th>
          <th className="px-3 py-2 w-16" />
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 100).map((r, idx) => {
          const key = `${r.agentId}-${r.alertId}-${idx}`;
          const open = expandedKey === key;
          return (
            <FragmentRow key={key}>
              <tr className="border-t border-white/5 align-top">
                <td className="px-3 py-2">
                  <Link
                    href={`/agents/${r.agentId}?tab=crowdsec`}
                    className="text-[hsl(var(--accent))] hover:underline"
                  >
                    {r.hostname}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs text-white/55 whitespace-nowrap">
                  {formatCrowdSecTime(r.alertAt ?? r.capturedAt)}
                </td>
                <td className="px-3 py-2 text-white/80">{r.scenario}</td>
                <td className="px-3 py-2 font-mono text-xs text-amber-100/90">
                  {r.source}
                </td>
                <td className="px-3 py-2 text-xs">{r.country}</td>
                <td className="px-3 py-2 text-xs text-white/60 max-w-[140px] truncate">
                  {r.asName}
                </td>
                <td className="px-3 py-2 text-xs font-mono">{r.method}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-white/70 max-w-[200px] truncate" title={r.target}>
                  {r.target}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-white/70">
                  {r.events ?? "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onToggleExpand(key)}
                    className="text-xs text-white/50 hover:text-white"
                  >
                    {open ? "Hide" : "More"}
                  </button>
                </td>
              </tr>
              <ExpandPanel
                open={open}
                raw={r.raw}
                fields={[
                  { label: "Alert ID", value: r.alertId },
                  { label: "Message", value: r.message },
                  { label: "Snapshot captured", value: formatCrowdSecTime(r.capturedAt) },
                ]}
              />
            </FragmentRow>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function DecisionsTable({
  rows,
  expandedKey,
  onToggleExpand,
}: {
  rows: CrowdSecDecisionRow[];
  expandedKey: string | null;
  onToggleExpand: (key: string) => void;
}) {
  if (!rows.length) {
    return (
      <div className="px-4 py-6 text-sm text-white/60">
        No active decisions in cached snapshots.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
    <table className="w-full min-w-[1100px] border-collapse text-sm">
      <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-white/50">
        <tr>
          <th className="px-3 py-2">Host</th>
          <th className="px-3 py-2">IP / value</th>
          <th className="px-3 py-2">Country</th>
          <th className="px-3 py-2">AS</th>
          <th className="px-3 py-2">Scope</th>
          <th className="px-3 py-2">Action</th>
          <th className="px-3 py-2">Origin</th>
          <th className="px-3 py-2">Expires</th>
          <th className="px-3 py-2">Scenario</th>
          <th className="px-3 py-2 text-right">Events</th>
          <th className="px-3 py-2 w-16" />
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 100).map((r, idx) => {
          const key = `${r.agentId}-${r.decisionId}-${idx}`;
          const open = expandedKey === key;
          return (
            <FragmentRow key={key}>
              <tr className="border-t border-white/5">
                <td className="px-3 py-2">
                  <Link
                    href={`/agents/${r.agentId}?tab=crowdsec`}
                    className="text-[hsl(var(--accent))] hover:underline"
                  >
                    {r.hostname}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-amber-100/90">
                  {r.value}
                </td>
                <td className="px-3 py-2 text-xs">{r.country}</td>
                <td className="px-3 py-2 text-xs text-white/60 max-w-[120px] truncate" title={r.asName}>
                  {r.asName}
                </td>
                <td className="px-3 py-2">{r.scope}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${actionBadgeClass(r.type)}`}
                  >
                    {r.type}
                    {r.simulated ? " (sim)" : ""}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-white/55">{r.origin}</td>
                <td className="px-3 py-2 text-white/70 whitespace-nowrap text-xs">
                  {r.duration}
                </td>
                <td className="px-3 py-2 text-xs text-white/60 max-w-[180px] truncate" title={r.scenario}>
                  {r.scenario}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-white/70">
                  {r.events ?? "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onToggleExpand(key)}
                    className="text-xs text-white/50 hover:text-white"
                  >
                    {open ? "Hide" : "More"}
                  </button>
                </td>
              </tr>
              <ExpandPanel
                open={open}
                raw={r.raw}
                fields={[
                  { label: "Decision ID", value: r.decisionId },
                  { label: "Linked alert", value: r.linkedAlertId },
                  { label: "Snapshot captured", value: formatCrowdSecTime(r.capturedAt) },
                  { label: "Simulated", value: r.simulated ? "yes" : "no" },
                ]}
              />
            </FragmentRow>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function FragmentRow({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
