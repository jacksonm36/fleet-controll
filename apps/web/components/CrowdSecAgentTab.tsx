"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CrowdSecAlertRow, CrowdSecDecisionRow } from "@/lib/crowdsec";
import {
  actionBadgeClass,
  countSnapshotDecisions,
  formatCrowdSecTime,
  unwrapCrowdSecSnapshot,
} from "@/lib/crowdsec";
import { apiFetch } from "@/lib/api";

export function CrowdSecAgentTab({
  agentId,
  hostname,
  snapshot,
}: {
  agentId: string;
  hostname: string;
  snapshot: unknown;
}) {
  const [alerts, setAlerts] = useState<CrowdSecAlertRow[]>([]);
  const [decisions, setDecisions] = useState<CrowdSecDecisionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const body = useMemo(() => unwrapCrowdSecSnapshot(snapshot), [snapshot]);

  useEffect(() => {
    const hostQ = `?host=${encodeURIComponent(hostname)}`;
    setLoading(true);
    void Promise.all([
      apiFetch<CrowdSecAlertRow[]>(`/api/crowdsec/alerts${hostQ}`, {
        cacheTtlMs: 10_000,
      }),
      apiFetch<CrowdSecDecisionRow[]>(`/api/crowdsec/decisions${hostQ}`, {
        cacheTtlMs: 10_000,
      }),
    ])
      .then(([a, d]) => {
        setAlerts(a.filter((row) => row.agentId === agentId).slice(0, 25));
        setDecisions(d.filter((row) => row.agentId === agentId).slice(0, 25));
      })
      .finally(() => setLoading(false));
  }, [agentId, hostname]);

  if (!body) {
    return (
      <p className="text-sm text-white/60">
        No CrowdSec snapshot yet — agent will populate after{" "}
        <code className="text-white/70">cscli</code> checks succeed.
      </p>
    );
  }

  const alertCached = body.alerts.length;
  const decisionCached = countSnapshotDecisions(body.decisions);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-white/45">Healthy</dt>
            <dd>{body.healthy === true ? "Yes" : body.healthy === false ? "No" : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-white/45">cscli version</dt>
            <dd className="font-mono text-xs">{body.version ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-white/45">Alerts cached</dt>
            <dd>{alertCached}</dd>
          </div>
          <div>
            <dt className="text-xs text-white/45">Decisions cached</dt>
            <dd>{decisionCached}</dd>
          </div>
        </dl>
        <Link
          href="/crowdsec"
          className="text-sm text-[hsl(var(--accent))] hover:underline"
        >
          Federated CrowdSec →
        </Link>
      </div>

      {body.capturedAt ? (
        <p className="text-xs text-white/45">
          Snapshot captured {formatCrowdSecTime(body.capturedAt)}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-white/50">Loading parsed alerts and decisions…</p>
      ) : null}

      {!loading && alerts.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-medium text-white/80">Recent alerts</h3>
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full min-w-[640px] border-collapse text-xs">
              <thead className="bg-white/5 text-left text-white/45">
                <tr>
                  <th className="px-2 py-1.5">Scenario</th>
                  <th className="px-2 py-1.5">Source</th>
                  <th className="px-2 py-1.5">Country</th>
                  <th className="px-2 py-1.5">Target</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="px-2 py-1.5">{a.scenario}</td>
                    <td className="px-2 py-1.5 font-mono text-amber-100/80">
                      {a.source}
                    </td>
                    <td className="px-2 py-1.5">{a.country}</td>
                    <td className="px-2 py-1.5 font-mono text-white/60 truncate max-w-[200px]">
                      {a.target}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!loading && decisions.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-medium text-white/80">Active decisions</h3>
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full min-w-[720px] border-collapse text-xs">
              <thead className="bg-white/5 text-left text-white/45">
                <tr>
                  <th className="px-2 py-1.5">IP</th>
                  <th className="px-2 py-1.5">Country</th>
                  <th className="px-2 py-1.5">Scope</th>
                  <th className="px-2 py-1.5">Action</th>
                  <th className="px-2 py-1.5">Expires</th>
                  <th className="px-2 py-1.5">Scenario</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="px-2 py-1.5 font-mono text-amber-100/80">
                      {d.value}
                    </td>
                    <td className="px-2 py-1.5">{d.country}</td>
                    <td className="px-2 py-1.5">{d.scope}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[10px] ${actionBadgeClass(d.type)}`}
                      >
                        {d.type}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{d.duration}</td>
                    <td className="px-2 py-1.5 text-white/60 truncate max-w-[160px]">
                      {d.scenario}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!loading && alertCached > 0 && alerts.length === 0 ? (
        <p className="text-xs text-amber-200/80">
          Snapshot lists {alertCached} alert(s) but none parsed for display — check raw JSON
          below.
        </p>
      ) : null}

      <details className="text-xs text-white/50">
        <summary className="cursor-pointer hover:text-white/70">Raw snapshot JSON</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded border border-white/10 bg-black/40 p-3 font-mono text-[11px] text-emerald-100/90">
          {JSON.stringify(snapshot, null, 2)}
        </pre>
      </details>
    </div>
  );
}
