"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import { JobLogs } from "@/components/JobLogs";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { useHydrated } from "@/lib/useHydrated";

type Agent = {
  id: string;
  hostname: string;
  osType: string;
  crowdsecInstalled: boolean;
  rebootRequired: boolean;
};

type Pkg = {
  id: string;
  name: string;
  version: string;
  manager: string;
};

type Svc = {
  id: string;
  name: string;
  kind: string;
  state: string;
};

type JobRow = {
  id: string;
  type: string;
  status: string;
  createdAt: string;
};

export default function AgentDetailPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [tab, setTab] = useState<
    "overview" | "packages" | "services" | "crowdsec" | "jobs"
  >("overview");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [services, setServices] = useState<Svc[]>([]);
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [serviceName, setServiceName] = useState("nginx.service");
  const [jobOpen, setJobOpen] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hydrated) return;
    if (!getToken()) router.replace("/login");
  }, [hydrated, router]);

  const reload = async () => {
    try {
      const [a, p, s, cs, j] = await Promise.all([
        apiFetch<Agent>(`/api/agents/${id}`),
        apiFetch<Pkg[]>(`/api/agents/${id}/packages`),
        apiFetch<Svc[]>(`/api/agents/${id}/services`),
        apiFetch<unknown | null>(`/api/agents/${id}/crowdsec`).catch(() => null),
        apiFetch<JobRow[]>(`/api/jobs?agentId=${encodeURIComponent(id)}`),
      ]);
      setAgent(a);
      setPackages(p);
      setServices(s);
      setSnapshot(cs);
      setJobs(j);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hydrated || !getToken()) return;

    setLoading(true);
    void reload().catch(() => setLoading(false));
    const timer = setInterval(() => void reload().catch(() => undefined), 20000);
    return () => clearInterval(timer);
  }, [id, hydrated]);

  const managerGuess = useMemo(() => {
    if (!agent) return "apt";
    if (agent.osType === "windows") return "winget";
    return "apt";
  }, [agent]);

  async function enqueueJob(type: string, payload: Record<string, unknown>) {
    await apiFetch("/api/jobs", {
      method: "POST",
      body: JSON.stringify({ agentId: id, type, payload }),
    });
    await reload();
  }

  if (!hydrated) return <AuthLoadingShell />;

  if (!getToken()) return null;

  if (loading || !agent) {
    return (
      <Shell>
        <div className="text-sm text-white/60">Loading agent…</div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-white/50">
              Agent
            </div>
            <h1 className="text-2xl font-semibold">{agent.hostname}</h1>
            <p className="text-sm text-white/60">
              {agent.osType.toUpperCase()} · CrowdSec{" "}
              {agent.crowdsecInstalled ? "enabled" : "not reporting"}
              {agent.rebootRequired ? " · reboot pending" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-white/10 px-3 py-2 text-xs hover:bg-white/20"
              onClick={() =>
                enqueueJob("PACKAGE_REFRESH", { manager: managerGuess })
              }
            >
              Queue inventory refresh
            </button>
            <button
              type="button"
              className="rounded-md bg-[hsl(var(--accent))] px-3 py-2 text-xs font-semibold text-black hover:opacity-90"
              onClick={() =>
                enqueueJob("PACKAGE_UPGRADE", {
                  manager: managerGuess,
                  all: true,
                })
              }
            >
              Queue upgrades ({managerGuess})
            </button>
          </div>
        </div>

        <div className="flex gap-2 border-b border-white/10 pb-2 text-sm">
          {(
            [
              "overview",
              "packages",
              "services",
              "crowdsec",
              "jobs",
            ] as const
          ).map((t) => (
            <button
              key={t}
              type="button"
              className={
                tab === t
                  ? "rounded-md bg-white/10 px-3 py-1 capitalize"
                  : "rounded-md px-3 py-1 capitalize text-white/60 hover:bg-white/5"
              }
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "overview" ? (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
              <div className="text-xs uppercase text-white/50">Packages</div>
              <div className="mt-2 text-3xl font-semibold">{packages.length}</div>
            </div>
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
              <div className="text-xs uppercase text-white/50">Services</div>
              <div className="mt-2 text-3xl font-semibold">{services.length}</div>
            </div>
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
              <div className="text-xs uppercase text-white/50">Recent jobs</div>
              <div className="mt-2 text-3xl font-semibold">{jobs.length}</div>
            </div>
          </div>
        ) : null}

        {tab === "packages" ? (
          <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-white/5 text-left text-xs uppercase text-white/50">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Version</th>
                  <th className="px-3 py-2">Manager</th>
                </tr>
              </thead>
              <tbody>
                {packages.slice(0, 500).map((p) => (
                  <tr key={p.id} className="border-t border-white/5">
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2 text-xs text-white/70">{p.version}</td>
                    <td className="px-3 py-2 text-xs">{p.manager}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {tab === "services" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
              <label className="text-xs">
                <div className="text-white/60">Unit / service name</div>
                <input
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  className="mt-1 rounded-md border border-[hsl(var(--border))] bg-black/30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]"
                />
              </label>
              <button
                type="button"
                className="rounded-md bg-emerald-500/90 px-3 py-2 text-xs font-semibold text-black hover:opacity-90"
                onClick={() =>
                  enqueueJob("SERVICE_RESTART", {
                    unitOrServiceName: serviceName,
                  })
                }
              >
                Restart
              </button>
              <button
                type="button"
                className="rounded-md bg-amber-400/90 px-3 py-2 text-xs font-semibold text-black hover:opacity-90"
                onClick={() =>
                  enqueueJob("SERVICE_STOP", {
                    unitOrServiceName: serviceName,
                  })
                }
              >
                Stop
              </button>
              <button
                type="button"
                className="rounded-md bg-sky-400/90 px-3 py-2 text-xs font-semibold text-black hover:opacity-90"
                onClick={() =>
                  enqueueJob("SERVICE_START", {
                    unitOrServiceName: serviceName,
                  })
                }
              >
                Start
              </button>
            </div>

            <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-white/5 text-left text-xs uppercase text-white/50">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">State</th>
                  </tr>
                </thead>
                <tbody>
                  {services.slice(0, 400).map((s) => (
                    <tr key={s.id} className="border-t border-white/5">
                      <td className="px-3 py-2">{s.name}</td>
                      <td className="px-3 py-2 text-xs">{s.kind}</td>
                      <td className="px-3 py-2 text-xs">{s.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "crowdsec" ? (
          <pre className="max-h-[520px] overflow-auto rounded-lg border border-[hsl(var(--border))] bg-black/40 p-4 text-xs text-emerald-100">
            {snapshot
              ? JSON.stringify(snapshot, null, 2)
              : "No CrowdSec snapshot yet — agent will populate after cscli/LAPI checks succeed."}
          </pre>
        ) : null}

        {tab === "jobs" ? (
          <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-white/5 text-left text-xs uppercase text-white/50">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-t border-white/5">
                    <td className="px-3 py-2 text-xs text-white/60">
                      {new Date(j.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{j.type}</td>
                    <td className="px-3 py-2">{j.status}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-xs text-[hsl(var(--accent))] hover:underline"
                        onClick={() => setJobOpen(j.id)}
                      >
                        Logs
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <JobLogs jobId={jobOpen} open={!!jobOpen} onClose={() => setJobOpen(null)} />
      </div>
    </Shell>
  );
}
