"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import { JobLogs } from "@/components/JobLogs";
import { apiFetch } from "@/lib/api";
import {
  managerLabel,
  planPackageCount,
  planStatusLabel,
  planStatusTone,
} from "@/lib/patch-ui";
import { usePolling } from "@/lib/usePolling";
import { useSession } from "@/lib/useSession";

type PatchRun = {
  id: string;
  agentId: string;
  patchPlanId?: string | null;
  jobId: string;
  manager: string;
  packageCount: number;
  exitStatus: string;
  startedAt: string;
  finishedAt?: string | null;
  summary?: {
    verification?: { passed?: boolean; issues?: string[] };
    rebootMayBeRequired?: boolean;
  } | null;
  agent?: { id: string; hostname: string };
  patchPlan?: { id: string; approvedById?: string | null } | null;
};

type PatchPlanPackage = {
  name: string;
  currentVersion?: string;
  targetVersion?: string;
  security?: boolean;
};

type PatchPlan = {
  id: string;
  agentId: string;
  status: string;
  manager: string;
  securityOnly: boolean;
  packages: PatchPlanPackage[];
  rebootMayBeRequired?: boolean;
  planSource?: string | null;
  createdAt: string;
  approvedAt?: string | null;
  executedAt?: string | null;
  dryRunJobId?: string | null;
  executeJobId?: string | null;
  agent?: { id: string; hostname: string };
};

type PatchHistoryRow = {
  id: string;
  kind: "run" | "plan";
  when: string;
  hostname: string;
  agentId: string;
  manager: string;
  packageCount: number;
  status: string;
  jobId?: string;
  planId?: string;
};

function runStatusLabel(status: string): string {
  if (status === "VERIFICATION_FAILED") return "Verification failed";
  return status;
}

function runStatusClass(status: string): string {
  if (status === "COMPLETED") return "text-emerald-400";
  if (status === "VERIFICATION_FAILED") return "text-amber-300";
  return "text-red-400";
}

export default function PatchesPage() {
  const { hydrated, checked, authed } = useSession();
  const [runs, setRuns] = useState<PatchRun[]>([]);
  const [plans, setPlans] = useState<PatchPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobOpen, setJobOpen] = useState<string | null>(null);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [ackRebootPlans, setAckRebootPlans] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  const reload = async () => {
    try {
      const [runData, planData] = await Promise.all([
        apiFetch<PatchRun[]>("/api/patch-plans/runs", { cacheTtlMs: 5_000 }),
        apiFetch<PatchPlan[]>("/api/patch-plans", { cacheTtlMs: 5_000 }),
      ]);
      setRuns(runData);
      setPlans(planData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hydrated || !authed) return;
    setLoading(true);
    void reload().catch(() => setLoading(false));
  }, [hydrated, authed]);

  usePolling(() => {
    if (!hydrated || !authed) return;
    void reload().catch(() => undefined);
  }, 10_000, false);

  const readyPlans = useMemo(
    () =>
      plans.filter(
        (p) => p.status === "READY" && planPackageCount(p.packages) > 0,
      ),
    [plans],
  );

  const inProgressPlans = useMemo(
    () =>
      plans.filter((p) =>
        ["PENDING_DRY_RUN", "APPROVED"].includes(p.status),
      ),
    [plans],
  );

  const history = useMemo(() => {
    const runPlanIds = new Set(
      runs.map((r) => r.patchPlanId).filter((id): id is string => !!id),
    );
    const rows: PatchHistoryRow[] = runs.map((r) => ({
      id: r.id,
      kind: "run",
      when: r.startedAt,
      hostname: r.agent?.hostname ?? r.agentId.slice(0, 8),
      agentId: r.agentId,
      manager: r.manager,
      packageCount: r.packageCount,
      status: runStatusLabel(r.exitStatus),
      jobId: r.jobId,
      planId: r.patchPlanId ?? undefined,
    }));

    for (const plan of plans) {
      if (runPlanIds.has(plan.id)) continue;
      if (plan.status === "READY") continue;
      const pkgCount = planPackageCount(plan.packages);
      rows.push({
        id: plan.id,
        kind: "plan",
        when: plan.executedAt ?? plan.approvedAt ?? plan.createdAt,
        hostname: plan.agent?.hostname ?? plan.agentId.slice(0, 8),
        agentId: plan.agentId,
        manager: plan.manager,
        packageCount: pkgCount,
        status: planStatusLabel(plan.status),
        jobId: plan.executeJobId ?? plan.dryRunJobId ?? undefined,
        planId: plan.id,
      });
    }

    return rows.sort(
      (a, b) => new Date(b.when).getTime() - new Date(a.when).getTime(),
    );
  }, [runs, plans]);

  async function approvePlan(plan: PatchPlan) {
    const names = (plan.packages ?? []).map((p) => p.name).filter(Boolean);
    if (!names.length) {
      setMsg("No packages in this preview — run a new preview on the agent.");
      return;
    }
    if (plan.rebootMayBeRequired && !ackRebootPlans.has(plan.id)) {
      setMsg("Confirm reboot may be required before approving.");
      return;
    }
    setBusyPlanId(plan.id);
    setMsg(null);
    try {
      await apiFetch(`/api/patch-plans/${plan.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ packageNames: names }),
      });
      setMsg(`Patch approved for ${plan.agent?.hostname ?? "host"} (${names.length} packages).`);
      setAckRebootPlans((prev) => {
        const next = new Set(prev);
        next.delete(plan.id);
        return next;
      });
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setBusyPlanId(null);
    }
  }

  async function rejectPlan(planId: string) {
    setBusyPlanId(planId);
    setMsg(null);
    try {
      await apiFetch(`/api/patch-plans/${planId}/reject`, { method: "POST" });
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setBusyPlanId(null);
    }
  }

  if (!hydrated || !checked) return <AuthLoadingShell />;
  if (!authed) return null;

  return (
    <Shell>
      <div className="space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-white/50">
            Patch history
          </div>
          <h1 className="text-2xl font-semibold">Patches</h1>
          <p className="mt-1 text-sm text-white/60">
            Safe live patching: preview → approve → batched upgrade with post-patch
            health checks. Inspired by{" "}
            <a
              href="https://github.com/PatchMon/PatchMon"
              className="text-[hsl(var(--accent))] hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              PatchMon
            </a>
            .
          </p>
        </div>

        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-sm text-white/70">
          <div className="text-xs uppercase text-white/50">Safety checks</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-white/60">
            <li>Dry-run preview before any install</li>
            <li>Operator approval required — no silent fleet-wide upgrades</li>
            <li>Upgrades run in small batches with service health verification</li>
            <li>Job fails if health score drops or systemd units become failed</li>
          </ul>
        </div>

        {inProgressPlans.length > 0 ? (
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase text-white/50">In progress</div>
            <ul className="mt-2 space-y-2 text-sm">
              {inProgressPlans.map((plan) => (
                <li key={plan.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {plan.agent?.hostname ?? plan.agentId.slice(0, 8)}
                    <span className="ml-2 text-xs text-white/50">
                      {planStatusLabel(plan.status)}
                    </span>
                  </span>
                  <Link
                    href={`/agents/${plan.agentId}`}
                    className="text-xs text-[hsl(var(--accent))] hover:underline"
                  >
                    View on agent
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {readyPlans.length > 0 ? (
          <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="text-xs uppercase text-amber-200/80">Awaiting approval</div>
            {readyPlans.map((plan) => {
              const count = planPackageCount(plan.packages);
              return (
                <div
                  key={plan.id}
                  className="rounded border border-white/10 bg-black/20 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">
                        {plan.agent?.hostname ?? plan.agentId.slice(0, 8)}
                        <span className="ml-2 text-xs text-white/50">
                          {managerLabel(plan.manager)} · {count} package{count === 1 ? "" : "s"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-white/50">
                        Previewed {new Date(plan.createdAt).toLocaleString()}
                        {plan.planSource ? ` · source: ${plan.planSource}` : ""}
                        {plan.securityOnly ? " · security only" : ""}
                      </p>
                      {plan.rebootMayBeRequired ? (
                        <label className="mt-2 flex items-center gap-2 text-xs text-amber-200">
                          <input
                            type="checkbox"
                            checked={ackRebootPlans.has(plan.id)}
                            onChange={(e) => {
                              setAckRebootPlans((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(plan.id);
                                else next.delete(plan.id);
                                return next;
                              });
                            }}
                          />
                          Reboot may be required after patching
                        </label>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/agents/${plan.agentId}`}
                        className="rounded-md border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
                      >
                        Review on agent
                      </Link>
                      <button
                        type="button"
                        disabled={!!busyPlanId || count === 0}
                        className="rounded-md bg-[hsl(var(--accent))] px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90 disabled:opacity-50"
                        onClick={() => void approvePlan(plan)}
                      >
                        {busyPlanId === plan.id ? "Approving…" : "Approve & patch"}
                      </button>
                      <button
                        type="button"
                        disabled={!!busyPlanId}
                        className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                        onClick={() => void rejectPlan(plan.id)}
                      >
                        Reject
                      </button>
                      {plan.dryRunJobId ? (
                        <button
                          type="button"
                          className="text-xs text-[hsl(var(--accent))] hover:underline"
                          onClick={() => setJobOpen(plan.dryRunJobId!)}
                        >
                          Preview logs
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {msg ? (
          <p className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
            {msg}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-white/60">Loading…</p>
        ) : history.length === 0 && readyPlans.length === 0 ? (
          <p className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 text-sm text-white/60">
            No patch activity yet. Open an agent, use <strong>Check for updates</strong>,
            then approve a plan here or on the agent page.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-white/5 text-left text-xs uppercase text-white/50">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Host</th>
                  <th className="px-3 py-2">Manager</th>
                  <th className="px-3 py-2">Packages</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={`${row.kind}-${row.id}`} className="border-t border-white/5">
                    <td className="px-3 py-2 text-xs text-white/60">
                      {new Date(row.when).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/agents/${row.agentId}`}
                        className="text-[hsl(var(--accent))] hover:underline"
                      >
                        {row.hostname}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs">{row.manager}</td>
                    <td className="px-3 py-2">{row.packageCount}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          row.kind === "run"
                            ? runStatusClass(
                                runs.find((r) => r.id === row.id)?.exitStatus ??
                                  row.status,
                              )
                            : planStatusTone(
                                plans.find((p) => p.id === row.id)?.status ??
                                  row.status,
                              )
                        }
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.jobId ? (
                        <button
                          type="button"
                          className="text-xs text-[hsl(var(--accent))] hover:underline"
                          onClick={() => setJobOpen(row.jobId!)}
                        >
                          Logs
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <JobLogs jobId={jobOpen} open={!!jobOpen} onClose={() => setJobOpen(null)} />
      </div>
    </Shell>
  );
}
