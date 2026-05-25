"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { useHydrated } from "@/lib/useHydrated";

type AgentRow = {
  id: string;
  hostname: string;
  osType: string;
  osDetail?: string | null;
  status: string;
  lastSeenAt: string | null;
  online: boolean;
  version?: string | null;
  rebootRequired: boolean;
  crowdsecInstalled: boolean;
  _count?: { packages: number; services: number; jobs: number };
};

export default function AgentsPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function removeAgent(agent: AgentRow) {
    const msg = `Remove agent "${agent.hostname}" from Fleet?\n\nThis deletes its inventory, jobs, and API credentials. The agent process on the host is not stopped automatically.`;
    if (!confirm(msg)) return;
    setDeletingId(agent.id);
    try {
      await apiFetch(`/api/agents/${agent.id}`, { method: "DELETE" });
      setRows((prev) => prev.filter((r) => r.id !== agent.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    if (!hydrated) return;
    if (!getToken()) router.replace("/login");
  }, [hydrated, router]);

  useEffect(() => {
    if (!hydrated || !getToken()) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<AgentRow[]>("/api/agents");
        if (!cancelled) setRows(data);
      } catch {
        /* handled globally */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  if (!hydrated) return <AuthLoadingShell />;

  if (!getToken()) return null;

  return (
    <Shell>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Agents</h1>
            <p className="text-sm text-white/60">
              Managed endpoints reporting inventory and executing patch jobs.
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase text-white/50">
              <tr>
                <th className="px-4 py-3">Hostname</th>
                <th className="px-4 py-3">OS</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Packages</th>
                <th className="px-4 py-3">CrowdSec</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3 font-medium">
                    <Link className="text-[hsl(var(--accent))]" href={`/agents/${a.id}`}>
                      {a.hostname}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="capitalize">{a.osType}</span>
                    {a.osDetail ? (
                      <span className="block text-xs text-white/50">{a.osDetail}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        a.online ? "text-emerald-400" : "text-amber-300"
                      }
                    >
                      {a.online ? "online" : "stale/offline"}
                    </span>
                  </td>
                  <td className="px-4 py-3">{a._count?.packages ?? 0}</td>
                  <td className="px-4 py-3">
                    {a.crowdsecInstalled ? "reporting" : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-white/60">
                    {a.version ?? "unknown"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                      disabled={deletingId === a.id}
                      onClick={() => void removeAgent(a)}
                    >
                      {deletingId === a.id ? "Removing…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td className="px-4 py-6 text-white/60" colSpan={7}>
                    No agents enrolled yet — mint a token under Enrollment and start an agent.
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
