"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import { apiFetch } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { useSession } from "@/lib/useSession";

type Status = {
  snapshotHosts: number;
  healthyHosts: number;
  alertTotal: number;
  decisionTotal: number;
};

export default function CrowdSecPage() {
  const { hydrated, checked, authed } = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [alerts, setAlerts] = useState<Record<string, unknown>[]>([]);
  const [decisions, setDecisions] = useState<Record<string, unknown>[]>([]);

  const loadCrowdsec = useCallback(async () => {
    if (!authed) return;
    try {
      const [s, a, d] = await Promise.all([
        apiFetch<Status>("/api/crowdsec/status", { cacheTtlMs: 10_000 }),
        apiFetch<Record<string, unknown>[]>("/api/crowdsec/alerts", {
          cacheTtlMs: 15_000,
        }),
        apiFetch<Record<string, unknown>[]>("/api/crowdsec/decisions", {
          cacheTtlMs: 15_000,
        }),
      ]);
      setStatus(s);
      setAlerts(a);
      setDecisions(d);
    } catch {
      /* handled globally */
    }
  }, [authed]);

  useEffect(() => {
    if (!hydrated || !authed) return;
    void loadCrowdsec();
  }, [hydrated, authed, loadCrowdsec]);

  usePolling(() => loadCrowdsec(), 30_000, false);

  if (!hydrated || !checked) return <AuthLoadingShell />;

  if (!authed) return null;

  return (
    <Shell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">CrowdSec · federated</h1>
          <p className="text-sm text-white/60">
            Aggregated snapshots pushed by agents from local `cscli` / LAPI checks.
          </p>
        </div>

        {status ? (
          <div className="grid gap-4 md:grid-cols-4">
            <Metric label="Hosts reporting" value={status.snapshotHosts} />
            <Metric label="Healthy snapshots" value={status.healthyHosts} />
            <Metric label="Alerts (cached)" value={status.alertTotal} />
            <Metric label="Decisions (cached)" value={status.decisionTotal} />
          </div>
        ) : (
          <div className="text-sm text-white/60">Loading CrowdSec posture…</div>
        )}

        <Section title="Recent alerts">
          <Rows rows={alerts} />
        </Section>

        <Section title="Active decisions">
          <Rows rows={decisions} />
        </Section>
      </div>
    </Shell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <div className="text-xs uppercase tracking-wide text-white/50">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
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
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        {children}
      </div>
    </div>
  );
}

function Rows({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) {
    return (
      <div className="px-4 py-6 text-sm text-white/60">
        Nothing cached yet — deploy CrowdSec on hosts and ensure agents can reach `cscli`
        or supply `CROWDSEC_API_KEY` for LAPI reads.
      </div>
    );
  }
  return (
    <table className="w-full border-collapse text-xs">
      <thead className="bg-white/5 text-left text-[11px] uppercase tracking-wide text-white/50">
        <tr>
          <th className="px-3 py-2">Host</th>
          <th className="px-3 py-2">Captured</th>
          <th className="px-3 py-2">Payload</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 80).map((r, idx) => (
          <tr key={idx} className="border-t border-white/5 align-top">
            <td className="px-3 py-2 text-white/80">{String(r.hostname ?? "")}</td>
            <td className="px-3 py-2 text-white/60">
              {r.capturedAt ? new Date(String(r.capturedAt)).toLocaleString() : ""}
            </td>
            <td className="px-3 py-2 font-mono text-[11px] text-emerald-100">
              <pre className="whitespace-pre-wrap break-all">
                {JSON.stringify(r.alert ?? r.decision ?? r, null, 2)}
              </pre>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
