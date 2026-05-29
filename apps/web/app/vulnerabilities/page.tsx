"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import { apiFetch } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { useSession } from "@/lib/useSession";

type CveRow = {
  id: string;
  cveId: string;
  packageName?: string | null;
  packageVersion?: string | null;
  manager?: string | null;
  severity: string;
  summary?: string | null;
  fixedVersion?: string | null;
  source: string;
  agent: { id: string; hostname: string; osType: string; online: boolean };
};

const severityClass: Record<string, string> = {
  CRITICAL: "bg-red-500/25 text-red-300",
  HIGH: "bg-orange-500/25 text-orange-300",
  MEDIUM: "bg-amber-500/25 text-amber-300",
  LOW: "bg-sky-500/25 text-sky-300",
  UNKNOWN: "bg-white/10 text-white/60",
};

export default function VulnerabilitiesPage() {
  const { hydrated, checked, authed } = useSession();
  const [rows, setRows] = useState<CveRow[]>([]);
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    if (!authed) return;
    const q =
      filter !== "all" ? `?severity=${encodeURIComponent(filter)}` : "";
    try {
      const data = await apiFetch<CveRow[]>(`/api/fleet/cves${q}`, {
        cacheTtlMs: 12_000,
      });
      setRows(data);
    } catch {
      /* global */
    }
  }, [authed, filter]);

  useEffect(() => {
    if (!hydrated || !authed) return;
    void load();
  }, [hydrated, authed, load]);

  usePolling(() => load(), 25_000, false);

  if (!hydrated || !checked) return <AuthLoadingShell />;
  if (!authed) return null;

  return (
    <Shell>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Vulnerabilities</h1>
          <p className="text-sm text-white/60">
            CVEs from agent scanners (trivy, debsecan, dnf) and OSV database
            matching on inventory refresh.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(["all", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={
                filter === s
                  ? "rounded-full bg-[hsl(var(--accent))]/20 px-3 py-1 text-xs font-medium text-[hsl(var(--accent))]"
                  : "rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs text-white/70"
              }
              onClick={() => setFilter(s)}
            >
              {s === "all" ? "All severities" : s}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase text-white/50">
              <tr>
                <th className="px-3 py-2">CVE</th>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Package</th>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Fix</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 font-mono text-xs">
                    <a
                      href={`https://nvd.nist.gov/vuln/detail/${r.cveId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[hsl(var(--accent))] hover:underline"
                    >
                      {r.cveId}
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        severityClass[r.severity] ?? severityClass.UNKNOWN
                      }`}
                    >
                      {r.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div>{r.packageName ?? "—"}</div>
                    {r.packageVersion ? (
                      <div className="text-xs text-white/50">{r.packageVersion}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/agents/${r.agent.id}`}
                      className="text-[hsl(var(--accent))]"
                    >
                      {r.agent.hostname}
                    </Link>
                    <span
                      className={`ml-1 text-[10px] ${
                        r.agent.online ? "text-emerald-400" : "text-amber-300"
                      }`}
                    >
                      {r.agent.online ? "online" : "offline"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-white/60">{r.source}</td>
                  <td className="px-3 py-2 text-xs text-white/60">
                    {r.fixedVersion ?? "—"}
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-white/50">
                    No CVEs recorded yet. Queue an inventory refresh on enrolled agents
                    (install trivy or debsecan on Debian for richer local scans).
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
