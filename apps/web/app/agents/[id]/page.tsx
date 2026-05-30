"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import { AgentActivityConsole } from "@/components/AgentActivityConsole";
import { JobLogs } from "@/components/JobLogs";
import { PatchPanel } from "@/components/PatchPanel";
import { CrowdSecAgentTab } from "@/components/CrowdSecAgentTab";
import { OsInfo } from "@/components/OsInfo";
import { apiFetch } from "@/lib/api";
import {
  pickActivePatchPlan,
  resolvePlanJobId,
  type PatchPlanLike,
} from "@/lib/patch-ui";
import { osSummaryLine } from "@/lib/os-display";
import { usePolling } from "@/lib/usePolling";
import { useSession } from "@/lib/useSession";

type Agent = {
  id: string;
  hostname: string;
  osType: string;
  osDetail: string | null;
  version: string | null;
  status: string;
  online: boolean;
  lastSeenAt: string | null;
  enrolledAt?: string | null;
  labels: Record<string, unknown> | null;
  crowdsecInstalled: boolean;
  rebootRequired: boolean;
  upgradeInProgress?: boolean;
  binaryUpgradeInProgress?: boolean;
  binaryUpgradeLastError?: string | null;
  kernelRunning?: string | null;
  kernelInstalled?: string | null;
  kernelUpdatePending?: boolean;
  packageUpdatesPending?: number;
  cveCount?: number;
  cveCriticalCount?: number;
  cveHighCount?: number;
  lastCveScanAt?: string | null;
  primaryIp?: string | null;
  ipAddresses?: string[];
  _count?: {
    packages: number;
    services: number;
    containers: number;
    jobs: number;
  };
};

function formatLastSeen(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString();
}

type Pkg = {
  id: string;
  name: string;
  version: string;
  manager: string;
  updateAvailable?: boolean;
  availableVersion?: string | null;
};

type Svc = {
  id: string;
  name: string;
  kind: string;
  state: string;
  enabled?: boolean | null;
  detail?: string | null;
};

type Container = {
  id: string;
  name: string;
  image: string;
  runtime: string;
  status: string;
  ports?: string | null;
  composeProject?: string | null;
};

type AppsSummary = {
  total: number;
  outdatedCount?: number;
  managers: string[];
  byManager: Record<string, Pkg[]>;
};

type JobRow = {
  id: string;
  type: string;
  status: string;
  createdAt: string;
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
  dryRunJobId?: string | null;
  executeJobId?: string | null;
  createdAt: string;
};

type CveFinding = {
  id: string;
  cveId: string;
  packageName?: string | null;
  packageVersion?: string | null;
  manager?: string | null;
  severity: string;
  summary?: string | null;
  fixedVersion?: string | null;
  source: string;
};

type CveResponse = {
  agent: {
    cveCount: number;
    cveCriticalCount: number;
    cveHighCount: number;
    lastCveScanAt: string | null;
  };
  findings: CveFinding[];
};

const cveSeverityClass: Record<string, string> = {
  CRITICAL: "bg-red-500/25 text-red-300",
  HIGH: "bg-orange-500/25 text-orange-300",
  MEDIUM: "bg-amber-500/25 text-amber-300",
  LOW: "bg-sky-500/25 text-sky-300",
  UNKNOWN: "bg-white/10 text-white/60",
};

export default function AgentDetailPage() {
  const router = useRouter();
  const { hydrated, checked, authed } = useSession();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = params.id;

  const [tab, setTab] = useState<
    | "overview"
    | "applications"
    | "containers"
    | "packages"
    | "services"
    | "cves"
    | "crowdsec"
    | "jobs"
    | "patches"
    | "console"
  >("overview");

  useEffect(() => {
    const t = searchParams.get("tab");
    if (
      t === "crowdsec" ||
      t === "overview" ||
      t === "applications" ||
      t === "containers" ||
      t === "packages" ||
      t === "services" ||
      t === "cves" ||
      t === "jobs" ||
      t === "patches" ||
      t === "console"
    ) {
      setTab(t);
    }
  }, [searchParams]);

  const [agent, setAgent] = useState<Agent | null>(null);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [applications, setApplications] = useState<AppsSummary | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [services, setServices] = useState<Svc[]>([]);
  const [appFilter, setAppFilter] = useState<string>("all");
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [patchPlans, setPatchPlans] = useState<PatchPlan[]>([]);
  const [securityOnly, setSecurityOnly] = useState(false);
  const [ackReboot, setAckReboot] = useState(false);
  const [selectedPlanPackages, setSelectedPlanPackages] = useState<
    Set<string>
  >(new Set());
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [cves, setCves] = useState<CveResponse | null>(null);
  const [serviceName, setServiceName] = useState("nginx.service");
  const [jobOpen, setJobOpen] = useState<string | null>(null);
  const [consoleJobId, setConsoleJobId] = useState<string | null>(null);
  const [consoleLogEpoch, setConsoleLogEpoch] = useState(0);
  const [consoleJobPinned, setConsoleJobPinned] = useState(false);

  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const reload = useCallback(async () => {
    try {
      const [a, p, apps, ctn, s, cs, j, cveData, plans] = await Promise.all([
        apiFetch<Agent>(`/api/agents/${id}`, { cacheTtlMs: 4_000 }),
        apiFetch<Pkg[]>(`/api/agents/${id}/packages`, { cacheTtlMs: 12_000 }),
        apiFetch<AppsSummary>(`/api/agents/${id}/applications`, {
          cacheTtlMs: 12_000,
        }).catch(() => null),
        apiFetch<Container[]>(`/api/agents/${id}/containers`, {
          cacheTtlMs: 12_000,
        }).catch(() => []),
        apiFetch<Svc[]>(`/api/agents/${id}/services`, { cacheTtlMs: 12_000 }),
        apiFetch<unknown | null>(`/api/agents/${id}/crowdsec`, {
          cacheTtlMs: 15_000,
        }).catch(() => null),
        apiFetch<JobRow[]>(`/api/jobs?agentId=${encodeURIComponent(id)}`, {
          cacheTtlMs: 5_000,
        }),
        apiFetch<CveResponse>(`/api/agents/${id}/cves`, {
          cacheTtlMs: 12_000,
        }).catch(() => null),
        apiFetch<PatchPlan[]>(
          `/api/patch-plans?agentId=${encodeURIComponent(id)}`,
          { cacheTtlMs: 5_000 },
        ).catch(() => []),
      ]);
      setAgent(a);
      setPackages(p);
      setApplications(apps);
      setContainers(ctn);
      setServices(s);
      setSnapshot(cs);
      setJobs(j);
      setCves(cveData);
      setPatchPlans(plans);
      const ready = pickActivePatchPlan(plans);
      if (ready) {
        setActivePlanId(ready.id);
        const names = (ready.packages ?? []).map((pkg) => pkg.name);
        setSelectedPlanPackages(new Set(names));
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!hydrated || !authed) return;
    setLoading(true);
    void reload().catch(() => setLoading(false));
  }, [hydrated, authed, reload]);

  usePolling(() => {
    if (!hydrated || !authed) return;
    void reload().catch(() => undefined);
  }, agent?.upgradeInProgress ||
    agent?.binaryUpgradeInProgress ||
    patchPlans.some(
      (p) => p.status === "PENDING_DRY_RUN" || p.status === "APPROVED",
    ) ||
    jobs.some(
      (j) =>
        j.type === "HOST_KERNEL_MAINTENANCE" &&
        (j.status === "QUEUED" || j.status === "RUNNING"),
    )
    ? 4_000
    : 10_000, false);

  const managerGuess = useMemo(() => {
    if (!agent) return "apt";
    if (agent.osType === "windows") return "winget";
    const mgrs = applications?.managers ?? [];
    if (mgrs.includes("dpkg")) return "apt";
    if (mgrs.includes("rpm")) return "dnf";
    return "apt";
  }, [agent, applications]);

  const outdatedApps = useMemo(() => {
    if (!applications) return [];
    return Object.values(applications.byManager)
      .flat()
      .filter((p) => p.updateAvailable);
  }, [applications]);

  const filteredApps = useMemo(() => {
    if (!applications) return [];
    if (appFilter === "outdated") return outdatedApps;
    if (appFilter === "all") {
      return Object.values(applications.byManager).flat();
    }
    return applications.byManager[appFilter] ?? [];
  }, [applications, appFilter, outdatedApps]);

  const activePlan = useMemo(
    () => patchPlans.find((pl) => pl.id === activePlanId) ?? null,
    [patchPlans, activePlanId],
  );

  function setConsoleJobSelection(
    jobId: string | null,
    opts?: { pin?: boolean; reload?: boolean },
  ) {
    setConsoleJobId(jobId);
    setConsoleJobPinned(opts?.pin ?? !!jobId);
    if (opts?.reload) setConsoleLogEpoch((n) => n + 1);
  }

  function openPatchPlan(pl: PatchPlanLike) {
    setActivePlanId(pl.id);
    setSelectedPlanPackages(new Set((pl.packages ?? []).map((pkg) => pkg.name)));
    const jid = resolvePlanJobId(pl, jobs);
    if (jid) {
      setConsoleJobSelection(jid, { pin: true, reload: true });
    } else {
      setActionMsg({
        kind: "err",
        text: "No job logs for this patch run yet. Run a new check or wait for the agent to finish.",
      });
    }
    document
      .getElementById("fleet-activity-console")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function createPatchPlan() {
    if (agent?.osType === "windows") {
      setActionMsg({
        kind: "err",
        text: "Patch plans are supported on Linux agents (apt/dnf).",
      });
      return;
    }
    setActionBusy("preview");
    setActionMsg(null);
    try {
      const res = await apiFetch<{ id: string; dryRunJob?: { id: string } }>(
        "/api/patch-plans",
        {
          method: "POST",
          body: JSON.stringify({
            agentId: id,
            manager: managerGuess === "winget" ? "apt" : managerGuess,
            securityOnly,
          }),
        },
      );
      setActivePlanId(res.id);
      setTab("patches");
      if (res.dryRunJob?.id) {
        setConsoleJobSelection(res.dryRunJob.id, { pin: true, reload: true });
      }
      setActionMsg({
        kind: "ok",
        text: "Dry-run queued — updates will appear here when the check finishes.",
      });
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create patch plan";
      if (msg.includes("patch_in_progress")) {
        setActionMsg({
          kind: "err",
          text: "A patch check or install is already running for this agent. Wait for it to finish or cancel it first.",
        });
      } else {
        setActionMsg({ kind: "err", text: msg });
      }
    } finally {
      setActionBusy(null);
    }
  }

  async function approvePatchPlan() {
    if (!activePlan) return;
    const names = [...selectedPlanPackages];
    if (!names.length) {
      setActionMsg({ kind: "err", text: "Select at least one update to install." });
      return;
    }
    if (activePlan.rebootMayBeRequired && !ackReboot) {
      setActionMsg({
        kind: "err",
        text: "Confirm the reboot notice before installing kernel updates.",
      });
      return;
    }
    setActionBusy("approve");
    setActionMsg(null);
    try {
      const res = await apiFetch<{ executeJob?: { id: string } }>(
        `/api/patch-plans/${activePlan.id}/approve`,
        {
          method: "POST",
          body: JSON.stringify({ packageNames: names }),
        },
      );
      if (res.executeJob?.id) setJobOpen(res.executeJob.id);
      setActionMsg({
        kind: "ok",
        text: `Installing ${names.length} update${names.length === 1 ? "" : "s"}…`,
      });
      setAckReboot(false);
      await reload();
    } catch (e) {
      setActionMsg({
        kind: "err",
        text: e instanceof Error ? e.message : "Approve failed",
      });
    } finally {
      setActionBusy(null);
    }
  }

  async function startKernelMaintenance(rebootOnly = false) {
    if (!agent || agent.osType === "windows") {
      setActionMsg({
        kind: "err",
        text: "Kernel maintenance is supported on Linux agents only.",
      });
      return;
    }
    setActionBusy("kernel");
    setActionMsg(null);
    try {
      const res = await apiFetch<{ jobId: string }>(
        `/api/agents/${id}/kernel-maintenance`,
        {
          method: "POST",
          body: JSON.stringify({ rebootOnly, rebootDelaySec: 5 }),
        },
      );
      setConsoleJobId(res.jobId);
      setTab("patches");
      setActionMsg({
        kind: "ok",
        text: rebootOnly
          ? "Reboot queued — live output appears in the activity console."
          : "Kernel update and reboot queued — live output appears in the activity console.",
      });
      await reload();
    } catch (e) {
      setActionMsg({
        kind: "err",
        text: e instanceof Error ? e.message : "Kernel maintenance failed",
      });
    } finally {
      setActionBusy(null);
    }
  }

  function isJobDeletable(status: string) {
    return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
  }

  function isJobCancellable(status: string) {
    return status === "QUEUED" || status === "RUNNING";
  }

  async function cancelJob(jobId: string) {
    if (!window.confirm("Cancel this job? The agent will stop if it has not finished yet.")) {
      return;
    }
    setActionBusy(`cancel-job-${jobId}`);
    setActionMsg(null);
    try {
      await apiFetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      if (consoleJobId === jobId) setConsoleJobId(null);
      setActionMsg({ kind: "ok", text: "Job cancelled." });
      await reload();
    } catch (e) {
      setActionMsg({
        kind: "err",
        text: e instanceof Error ? e.message : "Cancel failed",
      });
    } finally {
      setActionBusy(null);
    }
  }

  async function deleteJob(jobId: string) {
    const job = jobs.find((j) => j.id === jobId);
    if (job && !isJobDeletable(job.status)) {
      setActionMsg({
        kind: "err",
        text: "Cannot delete a queued or running job — wait until it finishes.",
      });
      return;
    }
    if (!window.confirm("Delete this job and its logs from Fleet?")) return;
    setActionBusy(`delete-job-${jobId}`);
    setActionMsg(null);
    try {
      await apiFetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      if (consoleJobId === jobId) setConsoleJobId(null);
      if (jobOpen === jobId) setJobOpen(null);
      setActionMsg({ kind: "ok", text: "Job deleted." });
      await reload();
    } catch (e) {
      setActionMsg({
        kind: "err",
        text: e instanceof Error ? e.message : "Delete failed",
      });
    } finally {
      setActionBusy(null);
    }
  }

  async function deleteAllJobs() {
    const deletable = jobs.filter((j) => isJobDeletable(j.status));
    if (!deletable.length) {
      setActionMsg({
        kind: "err",
        text: "No finished jobs to delete (queued or running jobs are kept).",
      });
      return;
    }
    const active = jobs.length - deletable.length;
    const extra =
      active > 0
        ? ` ${active} active job${active === 1 ? "" : "s"} will be kept.`
        : "";
    if (
      !window.confirm(
        `Delete ${deletable.length} finished job${deletable.length === 1 ? "" : "s"} for ${agent?.hostname ?? "this agent"}?${extra}`,
      )
    ) {
      return;
    }
    setActionBusy("delete-all-jobs");
    setActionMsg(null);
    try {
      const res = await apiFetch<{ deleted: number; skipped: number }>(
        `/api/agents/${id}/jobs`,
        { method: "DELETE" },
      );
      setConsoleJobId(null);
      setJobOpen(null);
      setActionMsg({
        kind: "ok",
        text: `Deleted ${res.deleted} job${res.deleted === 1 ? "" : "s"}.${
          res.skipped ? ` ${res.skipped} active job(s) kept.` : ""
        }`,
      });
      await reload();
    } catch (e) {
      setActionMsg({
        kind: "err",
        text: e instanceof Error ? e.message : "Delete all failed",
      });
    } finally {
      setActionBusy(null);
    }
  }

  async function rejectPatchPlan(planId: string) {
    setActionBusy("reject");
    try {
      await apiFetch(`/api/patch-plans/${planId}/reject`, { method: "POST" });
      if (activePlanId === planId) setActivePlanId(null);
      await reload();
    } catch (e) {
      setActionMsg({
        kind: "err",
        text: e instanceof Error ? e.message : "Reject failed",
      });
    } finally {
      setActionBusy(null);
    }
  }

  function togglePlanPackage(name: string) {
    setSelectedPlanPackages((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function enqueueJob(
    label: string,
    type: string,
    payload: Record<string, unknown>,
  ) {
    if (!agent?.online) {
      setActionMsg({
        kind: "err",
        text: "Agent is offline — job will queue but won't run until it reconnects.",
      });
    }
    setActionBusy(label);
    setActionMsg(null);
    try {
      const job = await apiFetch<JobRow>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({ agentId: id, type, payload }),
      });
      setActionMsg({
        kind: "ok",
        text: `Queued ${type.replace(/_/g, " ").toLowerCase()} (job ${job.id.slice(0, 8)}…).`,
      });
      setTab("jobs");
      await reload();
    } catch (e) {
      setActionMsg({
        kind: "err",
        text: e instanceof Error ? e.message : "Failed to queue job",
      });
    } finally {
      setActionBusy(null);
    }
  }

  async function deleteAgent() {
    if (!agent) return;
    const msg = `Remove agent "${agent.hostname}" from Fleet?\n\nThis deletes its inventory, jobs, and API credentials. The agent process on the host is not stopped automatically.`;
    if (!confirm(msg)) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/agents/${id}`, { method: "DELETE" });
      router.push("/agents");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
      setDeleting(false);
    }
  }

  function openRename() {
    if (!agent) return;
    setRenameValue(agent.hostname);
    setRenaming(true);
  }

  async function saveRename(e: React.FormEvent) {
    e.preventDefault();
    if (!agent) return;
    const hostname = renameValue.trim();
    if (!hostname) return;
    setRenameBusy(true);
    try {
      const updated = await apiFetch<Agent>(`/api/agents/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ hostname }),
      });
      setAgent(updated);
      setRenaming(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setRenameBusy(false);
    }
  }

  if (!hydrated || !checked) return <AuthLoadingShell />;

  if (!authed) return null;

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
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold">{agent.hostname}</h1>
              <span
                className={
                  agent.online
                    ? "rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-400"
                    : "rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-medium text-amber-300"
                }
              >
                {agent.online ? "Online" : "Stale / offline"}
              </span>
            </div>
            <p className="mt-1 text-sm text-white/60">
              {osSummaryLine(agent.osType, agent.osDetail)}
              {agent.version ? ` · agent ${agent.version}` : ""}
              {" · "}CrowdSec{" "}
              {agent.crowdsecInstalled ? "enabled" : "not reporting"}
              {agent.rebootRequired ? " · reboot pending" : ""}
              {(agent.packageUpdatesPending ?? 0) > 0
                ? ` · ${agent.packageUpdatesPending} app updates`
                : ""}
              {agent.kernelUpdatePending ? " · kernel update" : ""}
              {(agent.cveCount ?? 0) > 0
                ? ` · ${agent.cveCount} CVE${agent.cveCount === 1 ? "" : "s"}`
                : ""}
            </p>
            <p className="text-xs text-white/40">
              Enrolled{" "}
              {agent.enrolledAt
                ? new Date(agent.enrolledAt).toLocaleString()
                : "unknown"}
              {" · "}Last seen {formatLastSeen(agent.lastSeenAt)}
            </p>
            {agent.upgradeInProgress || agent.binaryUpgradeInProgress ? (
              <div className="mt-3 max-w-xl rounded-md bg-white/5 p-3">
                <div className="text-xs text-amber-200">
                  {agent.upgradeInProgress
                    ? "Package upgrade running…"
                    : "Upgrading agent binary…"}
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-white/10">
                  <div className="h-full w-2/3 animate-pulse rounded bg-[hsl(var(--accent))]" />
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!!actionBusy}
                title={
                  agent.online
                    ? "Collect packages, services, Docker, snap"
                    : "Agent offline — queues until online"
                }
                className="rounded-md bg-white/10 px-3 py-2 text-xs hover:bg-white/20 disabled:opacity-50"
                onClick={() =>
                  void enqueueJob("refresh", "PACKAGE_REFRESH", {})
                }
              >
                {actionBusy === "refresh"
                  ? "Queuing…"
                  : "Queue inventory refresh"}
              </button>
              <button
                type="button"
                disabled={!!actionBusy}
                title="Check for available system updates"
                className="rounded-md border border-[hsl(var(--accent))]/40 px-3 py-2 text-xs text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent))]/10 disabled:opacity-50"
                onClick={() => {
                  setTab("patches");
                  void createPatchPlan();
                }}
              >
                {actionBusy === "preview" ? "Checking…" : "Check for updates"}
              </button>
              <label className="flex items-center gap-1.5 self-center text-xs text-white/60">
                <input
                  type="checkbox"
                  checked={securityOnly}
                  onChange={(e) => setSecurityOnly(e.target.checked)}
                  className="rounded"
                />
                Security only
              </label>
            <button
              type="button"
              className="rounded-md border border-white/20 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
              onClick={openRename}
            >
              Rename
            </button>
            <button
              type="button"
              className="rounded-md border border-red-500/40 px-3 py-2 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
              disabled={deleting}
              onClick={() => void deleteAgent()}
            >
              {deleting ? "Removing…" : "Delete agent"}
            </button>
            </div>
            {actionMsg && (
              <p
                className={`max-w-md text-right text-xs ${
                  actionMsg.kind === "ok" ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {actionMsg.text}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 border-b border-white/10 pb-2 text-sm">
          {(
            [
              "overview",
              "applications",
              "containers",
              "services",
              "packages",
              "cves",
              "crowdsec",
              "jobs",
              "patches",
              "console",
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
              {t === "cves"
                ? `cves${(agent.cveCount ?? 0) > 0 ? ` (${agent.cveCount})` : ""}`
                : t === "console"
                  ? "Console"
                  : t}
            </button>
          ))}
        </div>

        {tab === "overview" ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
              <div className="text-xs uppercase text-white/50">Agent information</div>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs text-white/50">Hostname</dt>
                  <dd className="font-medium">{agent.hostname}</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/50">IP address</dt>
                  <dd className="font-mono text-xs">
                    {agent.primaryIp ?? "Unknown"}
                    {agent.ipAddresses && agent.ipAddresses.length > 1 ? (
                      <span className="mt-1 block font-sans text-xs text-white/50">
                        Also:{" "}
                        {agent.ipAddresses
                          .filter((ip) => ip !== agent.primaryIp)
                          .join(", ")}
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/50">Agent ID</dt>
                  <dd className="break-all font-mono text-xs text-white/80">{agent.id}</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/50">Connection</dt>
                  <dd className={agent.online ? "text-emerald-400" : "text-amber-300"}>
                    {agent.online ? "Online (seen within ~45s)" : "Stale / offline"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-white/50">OS</dt>
                  <dd className="mt-0.5">
                    <OsInfo osType={agent.osType} osDetail={agent.osDetail} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/50">Agent binary</dt>
                  <dd>{agent.version ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/50">Enrolled</dt>
                  <dd>
                    {agent.enrolledAt
                      ? new Date(agent.enrolledAt).toLocaleString()
                      : "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/50">Last seen</dt>
                  <dd>{formatLastSeen(agent.lastSeenAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/50">Recorded status</dt>
                  <dd className="capitalize">{agent.status.toLowerCase()}</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/50">CrowdSec</dt>
                  <dd>
                    {snapshot
                      ? "Snapshot on file"
                      : agent.crowdsecInstalled
                        ? "Installed (awaiting snapshot)"
                        : "Not detected"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/50">Reboot</dt>
                  <dd>{agent.rebootRequired ? "Required" : "Not required"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/50">Running kernel</dt>
                  <dd className="font-mono text-xs">
                    {agent.kernelRunning ?? "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/50">Installed kernel</dt>
                  <dd className="font-mono text-xs">
                    {agent.kernelInstalled ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/50">Kernel update</dt>
                  <dd
                    className={
                      agent.kernelUpdatePending ? "text-amber-300" : "text-emerald-400"
                    }
                  >
                    {agent.kernelUpdatePending
                      ? "Update available or reboot required"
                      : "Up to date"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/50">Outdated applications</dt>
                  <dd
                    className={
                      (agent.packageUpdatesPending ?? 0) > 0
                        ? "text-amber-300"
                        : "text-emerald-400"
                    }
                  >
                    {agent.packageUpdatesPending ?? applications?.outdatedCount ?? 0}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/50">CVE findings</dt>
                  <dd
                    className={
                      (agent.cveCount ?? 0) > 0 ? "text-red-300" : "text-emerald-400"
                    }
                  >
                    {agent.cveCount ?? 0}
                    {(agent.cveCriticalCount ?? 0) > 0
                      ? ` (${agent.cveCriticalCount} critical)`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-white/50">Last CVE scan</dt>
                  <dd className="text-xs">
                    {agent.lastCveScanAt
                      ? new Date(agent.lastCveScanAt).toLocaleString()
                      : "Not scanned yet"}
                  </dd>
                </div>
                {agent.labels && Object.keys(agent.labels).length > 0 ? (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <dt className="text-xs text-white/50">Labels</dt>
                    <dd className="mt-1 font-mono text-xs text-white/70">
                      {JSON.stringify(agent.labels)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
                <div className="text-xs uppercase text-white/50">Applications</div>
                <div className="mt-2 text-3xl font-semibold">
                  {applications?.total ?? agent._count?.packages ?? packages.length}
                </div>
                <div className="mt-1 text-xs text-white/45">
                  {applications?.managers.length
                    ? applications.managers.join(", ")
                    : "dpkg · snap · docker…"}
                </div>
              </div>
              <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
                <div className="text-xs uppercase text-white/50">Outdated</div>
                <div
                  className={`mt-2 text-3xl font-semibold ${
                    (applications?.outdatedCount ?? agent.packageUpdatesPending ?? 0) > 0
                      ? "text-amber-300"
                      : ""
                  }`}
                >
                  {applications?.outdatedCount ??
                    agent.packageUpdatesPending ??
                    outdatedApps.length}
                </div>
                <div className="mt-1 text-xs text-white/45">apt · dnf · snap · winget</div>
              </div>
              <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
                <div className="text-xs uppercase text-white/50">Containers</div>
                <div className="mt-2 text-3xl font-semibold">
                  {agent._count?.containers ?? containers.length}
                </div>
                <div className="mt-1 text-xs text-white/45">Docker / Podman</div>
              </div>
              <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
                <div className="text-xs uppercase text-white/50">Services</div>
                <div className="mt-2 text-3xl font-semibold">
                  {agent._count?.services ?? services.length}
                </div>
                <div className="mt-1 text-xs text-white/45">systemd · snap · launchd</div>
              </div>
              <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
                <div className="text-xs uppercase text-white/50">Jobs</div>
                <div className="mt-2 text-3xl font-semibold">
                  {agent._count?.jobs ?? jobs.length}
                </div>
              </div>
            </div>
            {!packages.length && !services.length && !containers.length ? (
              <p className="text-sm text-white/50">
                Inventory is empty until the agent reports in (every ~10 min) or you queue
                &quot;inventory refresh&quot; above. Detects dpkg, snap, flatpak, Docker images,
                systemd units, and running containers.
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === "applications" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={
                  appFilter === "outdated"
                    ? "rounded-full bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-300"
                    : "rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs text-white/70"
                }
                onClick={() => setAppFilter("outdated")}
              >
                Outdated (
                {applications?.outdatedCount ??
                  agent.packageUpdatesPending ??
                  outdatedApps.length}
                )
              </button>
              <button
                type="button"
                className={
                  appFilter === "all"
                    ? "rounded-full bg-[hsl(var(--accent))]/20 px-3 py-1 text-xs font-medium text-[hsl(var(--accent))]"
                    : "rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs text-white/70"
                }
                onClick={() => setAppFilter("all")}
              >
                All ({applications?.total ?? 0})
              </button>
              {(applications?.managers ?? []).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={
                    appFilter === m
                      ? "rounded-full bg-[hsl(var(--accent))]/20 px-3 py-1 text-xs font-medium text-[hsl(var(--accent))]"
                      : "rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs text-white/70"
                  }
                  onClick={() => setAppFilter(m)}
                >
                  {m} ({applications?.byManager[m]?.length ?? 0})
                </button>
              ))}
            </div>
            <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-white/5 text-left text-xs uppercase text-white/50">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Installed</th>
                    <th className="px-3 py-2">Available</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApps.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-sm text-white/50">
                        {appFilter === "outdated"
                          ? "No outdated applications detected. Queue an inventory refresh to re-check apt, dnf, snap, or winget."
                          : "No applications in this filter."}
                      </td>
                    </tr>
                  ) : null}
                  {filteredApps.slice(0, 500).map((p) => (
                    <tr
                      key={p.id}
                      className={
                        p.updateAvailable
                          ? "border-t border-amber-500/20 bg-amber-500/5"
                          : "border-t border-white/5"
                      }
                    >
                      <td className="px-3 py-2">
                        {p.name}
                        {p.updateAvailable ? (
                          <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">
                            update
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-white/70">{p.version || "—"}</td>
                      <td className="px-3 py-2 text-xs text-amber-200/90">
                        {p.updateAvailable
                          ? p.availableVersion ?? "newer"
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs capitalize text-[hsl(var(--accent))]">
                        {p.manager}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "containers" ? (
          <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            {containers.length === 0 ? (
              <p className="px-4 py-6 text-sm text-white/50">
                No containers detected. Install Docker or Podman on the agent host and ensure the
                agent user can run <code className="text-[hsl(var(--accent))]">docker ps</code> (or
                use sudo).
              </p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead className="bg-white/5 text-left text-xs uppercase text-white/50">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Image</th>
                    <th className="px-3 py-2">Runtime</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Ports</th>
                  </tr>
                </thead>
                <tbody>
                  {containers.map((c) => (
                    <tr key={c.id} className="border-t border-white/5">
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2 text-xs text-white/70">{c.image}</td>
                      <td className="px-3 py-2 text-xs capitalize">{c.runtime}</td>
                      <td className="px-3 py-2 text-xs">{c.status}</td>
                      <td className="px-3 py-2 text-xs text-white/60">
                        {c.ports ?? "—"}
                        {c.composeProject ? ` · compose:${c.composeProject}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}

        {tab === "cves" ? (
          <div className="space-y-3">
            <p className="text-sm text-white/55">
              Scanned via trivy, debsecan, dnf security advisories, and OSV API (package
              name + version). Queue inventory refresh to update.
            </p>
            <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-white/5 text-left text-xs uppercase text-white/50">
                  <tr>
                    <th className="px-3 py-2">CVE</th>
                    <th className="px-3 py-2">Severity</th>
                    <th className="px-3 py-2">Package</th>
                    <th className="px-3 py-2">Fix</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {(cves?.findings ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-sm text-white/50">
                        No CVEs on record. Install{" "}
                        <code className="text-[hsl(var(--accent))]">trivy</code> or{" "}
                        <code className="text-[hsl(var(--accent))]">debsecan</code> on the
                        host for deeper scans, then refresh inventory.
                      </td>
                    </tr>
                  ) : null}
                  {(cves?.findings ?? []).map((c) => (
                    <tr key={c.id} className="border-t border-white/5">
                      <td className="px-3 py-2 font-mono text-xs">
                        <a
                          href={`https://nvd.nist.gov/vuln/detail/${c.cveId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[hsl(var(--accent))] hover:underline"
                        >
                          {c.cveId}
                        </a>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                            cveSeverityClass[c.severity] ?? cveSeverityClass.UNKNOWN
                          }`}
                        >
                          {c.severity}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div>{c.packageName ?? "—"}</div>
                        {c.packageVersion ? (
                          <div className="text-xs text-white/50">{c.packageVersion}</div>
                        ) : null}
                        {c.summary ? (
                          <div className="mt-1 line-clamp-2 text-xs text-white/45">
                            {c.summary}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-white/60">
                        {c.fixedVersion ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-white/60">{c.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "packages" ? (
          <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-white/5 text-left text-xs uppercase text-white/50">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Installed</th>
                  <th className="px-3 py-2">Available</th>
                  <th className="px-3 py-2">Manager</th>
                </tr>
              </thead>
              <tbody>
                {packages.slice(0, 500).map((p) => (
                  <tr
                    key={p.id}
                    className={
                      p.updateAvailable
                        ? "border-t border-amber-500/20 bg-amber-500/5"
                        : "border-t border-white/5"
                    }
                  >
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2 text-xs text-white/70">{p.version}</td>
                    <td className="px-3 py-2 text-xs text-amber-200/90">
                      {p.updateAvailable ? p.availableVersion ?? "yes" : "—"}
                    </td>
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
                  void enqueueJob("service-restart", "SERVICE_RESTART", {
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
                  void enqueueJob("service-stop", "SERVICE_STOP", {
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
                  void enqueueJob("service-start", "SERVICE_START", {
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
                    <th className="px-3 py-2">Enabled</th>
                    <th className="px-3 py-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {services.slice(0, 500).map((s) => (
                    <tr key={s.id} className="border-t border-white/5">
                      <td className="px-3 py-2">{s.name}</td>
                      <td className="px-3 py-2 text-xs capitalize text-[hsl(var(--accent))]">
                        {s.kind}
                      </td>
                      <td className="px-3 py-2 text-xs">{s.state}</td>
                      <td className="px-3 py-2 text-xs">
                        {s.enabled == null ? "—" : s.enabled ? "yes" : "no"}
                      </td>
                      <td className="px-3 py-2 text-xs text-white/50">{s.detail ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "crowdsec" && agent ? (
          <CrowdSecAgentTab
            agentId={agent.id}
            hostname={agent.hostname}
            snapshot={snapshot}
          />
        ) : null}

        {tab === "jobs" ? (
          <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
              <span className="text-xs uppercase text-white/45">
                {jobs.length} job{jobs.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                disabled={
                  !!actionBusy ||
                  !jobs.some((j) => isJobDeletable(j.status))
                }
                className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                onClick={() => void deleteAllJobs()}
              >
                {actionBusy === "delete-all-jobs" ? "Deleting…" : "Delete all finished"}
              </button>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead className="bg-white/5 text-left text-xs uppercase text-white/50">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-6 text-center text-sm text-white/45"
                    >
                      No jobs yet.
                    </td>
                  </tr>
                ) : (
                  jobs.map((j) => (
                    <tr key={j.id} className="border-t border-white/5">
                      <td className="px-3 py-2 text-xs text-white/60">
                        {new Date(j.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">{j.type}</td>
                      <td className="px-3 py-2">{j.status}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-3">
                          <button
                            type="button"
                            className="text-xs text-[hsl(var(--accent))] hover:underline"
                            onClick={() => {
                              setConsoleJobId(j.id);
                              setTab("console");
                            }}
                          >
                            Console
                          </button>
                          {isJobCancellable(j.status) ? (
                            <button
                              type="button"
                              disabled={!!actionBusy}
                              className="text-xs text-amber-300 hover:underline disabled:opacity-50"
                              onClick={() => void cancelJob(j.id)}
                            >
                              {actionBusy === `cancel-job-${j.id}`
                                ? "Cancelling…"
                                : "Cancel"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={
                              !!actionBusy || !isJobDeletable(j.status)
                            }
                            title={
                              isJobDeletable(j.status)
                                ? "Delete job and logs"
                                : "Cancel or wait until the job finishes"
                            }
                            className="text-xs text-red-300 hover:underline disabled:cursor-not-allowed disabled:text-white/25 disabled:no-underline"
                            onClick={() => void deleteJob(j.id)}
                          >
                            {actionBusy === `delete-job-${j.id}`
                              ? "Deleting…"
                              : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        {tab === "console" ? (
          <AgentActivityConsole
            agentHostname={agent.hostname}
            patchPlans={patchPlans}
            activePlan={activePlan}
            jobs={jobs}
            selectedJobId={consoleJobId}
            onSelectJobId={setConsoleJobSelection}
            consoleLogEpoch={consoleLogEpoch}
            pinConsoleJob={consoleJobPinned}
            binaryUpgrading={agent.binaryUpgradeInProgress}
            binaryUpgradeError={agent.binaryUpgradeLastError}
            agentVersion={agent.version}
          />
        ) : null}

        {tab === "patches" ? (
          <PatchPanel
            agentHostname={agent.hostname}
            packageUpdatesPending={agent.packageUpdatesPending}
            kernelUpdatePending={agent.kernelUpdatePending}
            cveCount={agent.cveCount}
            patchPlans={patchPlans}
            activePlan={activePlan}
            selectedPlanPackages={selectedPlanPackages}
            securityOnly={securityOnly}
            setSecurityOnly={setSecurityOnly}
            ackReboot={ackReboot}
            setAckReboot={setAckReboot}
            actionBusy={actionBusy}
            onCheckUpdates={() => void createPatchPlan()}
            onKernelMaintenance={(rebootOnly) => void startKernelMaintenance(rebootOnly)}
            rebootRequired={agent.rebootRequired}
            kernelRunning={agent.kernelRunning}
            kernelInstalled={agent.kernelInstalled}
            onInstall={() => void approvePatchPlan()}
            onCancel={(planId) => void rejectPatchPlan(planId)}
            onSelectPlan={(pl) => {
              setActivePlanId(pl.id);
              setSelectedPlanPackages(
                new Set((pl.packages ?? []).map((pkg) => pkg.name)),
              );
            }}
            onTogglePackage={togglePlanPackage}
            onSelectAll={() =>
              setSelectedPlanPackages(
                new Set((activePlan?.packages ?? []).map((p) => p.name)),
              )
            }
            onClearSelection={() => setSelectedPlanPackages(new Set())}
            jobs={jobs}
            consoleJobId={consoleJobId}
            onConsoleJobId={setConsoleJobSelection}
            onOpenPlan={openPatchPlan}
            consoleLogEpoch={consoleLogEpoch}
            pinConsoleJob={consoleJobPinned}
            binaryUpgrading={agent.binaryUpgradeInProgress}
            binaryUpgradeError={agent.binaryUpgradeLastError}
            agentVersion={agent.version}
          />
        ) : null}

        <JobLogs jobId={jobOpen} open={!!jobOpen} onClose={() => setJobOpen(null)} />

        {renaming ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <form
              onSubmit={(e) => void saveRename(e)}
              className="w-full max-w-md space-y-3 rounded-xl border border-white/10 bg-[hsl(var(--card))] p-5"
            >
              <h2 className="text-lg font-medium">Rename agent</h2>
              <p className="text-sm text-white/60">
                This updates the display name in Fleet only. It does not change
                the hostname on the machine.
              </p>
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="Agent name"
                autoFocus
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenaming(false)}
                  className="rounded-md px-3 py-2 text-sm text-white/70 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={renameBusy || !renameValue.trim()}
                  className="rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                >
                  {renameBusy ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
