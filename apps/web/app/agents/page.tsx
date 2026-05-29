"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import { AgentBinaryDeploySection } from "@/components/AgentBinaryDeploySection";
import { AgentEnrollmentSection } from "@/components/AgentEnrollmentSection";
import { BinaryDeployConsole } from "@/components/BinaryDeployConsole";
import { OsInfo } from "@/components/OsInfo";
import { apiFetch } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { useSession } from "@/lib/useSession";

type AgentReleaseInfo = {
  built: boolean;
  hint?: string;
  manifest?: {
    version: string;
    buildId: string;
    builtAt: string;
  };
};

type AgentRow = {
  id: string;
  hostname: string;
  osType: string;
  osDetail?: string | null;
  status: string;
  lastSeenAt: string | null;
  enrolledAt?: string | null;
  online: boolean;
  binaryUpgradeInProgress?: boolean;
  binaryUpgradeLastError?: string | null;
  upgradeInProgress?: boolean;
  version?: string | null;
  rebootRequired: boolean;
  crowdsecInstalled: boolean;
  kernelRunning?: string | null;
  kernelUpdatePending?: boolean;
  packageUpdatesPending?: number;
  cveCount?: number;
  cveCriticalCount?: number;
  _count?: { packages: number; services: number; jobs: number };
};

export default function AgentsPage() {
  const { hydrated, checked, authed } = useSession();
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [release, setRelease] = useState<AgentReleaseInfo | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<AgentRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [deploySessionId, setDeploySessionId] = useState<string | null>(null);

  function openRename(agent: AgentRow) {
    setRenaming(agent);
    setRenameValue(agent.hostname);
  }

  async function saveRename(e: React.FormEvent) {
    e.preventDefault();
    if (!renaming) return;
    const hostname = renameValue.trim();
    if (!hostname) return;
    setRenameBusy(true);
    try {
      const updated = await apiFetch<AgentRow>(`/api/agents/${renaming.id}`, {
        method: "PATCH",
        body: JSON.stringify({ hostname }),
      });
      setRows((prev) =>
        prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)),
      );
      setRenaming(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setRenameBusy(false);
    }
  }

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

  const loadAgents = useCallback(async () => {
    if (!authed) return;
    try {
      const data = await apiFetch<AgentRow[]>("/api/agents", {
        cacheTtlMs: 6_000,
      });
      setRows(data);
    } catch {
      /* handled globally */
    }
  }, [authed]);

  useEffect(() => {
    if (!hydrated || !authed) return;
    void loadAgents();
    void apiFetch<AgentReleaseInfo>("/api/agents/agent-release", { cacheTtlMs: 30_000 })
      .then(setRelease)
      .catch(() => setRelease(null));
  }, [hydrated, authed, loadAgents]);

  async function pushBinaryUpdate() {
    setPushing(true);
    setPushMsg(null);
    try {
      const res = await apiFetch<{
        notified: number;
        buildId: string;
        version: string;
        sessionId?: string;
      }>("/api/agents/push-binary-update", { method: "POST" });
      setPushMsg(
        `Notified ${res.notified} online agent(s) to upgrade to ${res.version}+${res.buildId}.`,
      );
      if (res.sessionId) {
        setDeploySessionId(res.sessionId);
        setConsoleOpen(true);
      }
      void loadAgents();
    } catch (e) {
      setPushMsg(e instanceof Error ? e.message : "Push failed");
    } finally {
      setPushing(false);
    }
  }

  const outdatedCount = useMemo(() => {
    if (!release?.manifest) return 0;
    const target = `${release.manifest.version}+${release.manifest.buildId}`.toLowerCase();
    return rows.filter((a) => {
      const v = (a.version ?? "").toLowerCase();
      return a.online && v !== target;
    }).length;
  }, [rows, release]);

  const hasVisibleUpgradeState = useMemo(() => {
    if (!release?.manifest) {
      return rows.some((a) => a.upgradeInProgress || a.binaryUpgradeInProgress);
    }
    const target = `${release.manifest.version}+${release.manifest.buildId}`.toLowerCase();
    return rows.some((a) => {
      const v = (a.version ?? "").toLowerCase();
      const outdated = a.online && v !== target;
      return a.upgradeInProgress || a.binaryUpgradeInProgress || outdated;
    });
  }, [rows, release]);

  usePolling(() => loadAgents(), hasVisibleUpgradeState ? 5_000 : 8_000, false);

  if (!hydrated || !checked) return <AuthLoadingShell />;

  if (!authed) return null;

  return (
    <Shell>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Agents</h1>
            <p className="text-sm text-white/60">
              Enroll hosts, push agent updates, and manage enrolled endpoints.
            </p>
          </div>
          <Link
            href="/automation"
            className="rounded-md border border-white/20 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            Ansible &amp; jobs →
          </Link>
        </div>

        <AgentEnrollmentSection agentCount={rows.length} />

        <AgentBinaryDeploySection
          release={release}
          outdatedCount={outdatedCount}
          pushMsg={pushMsg}
          pushing={pushing}
          onPush={() => void pushBinaryUpdate()}
          onOpenConsole={() => {
            setDeploySessionId(null);
            setConsoleOpen(true);
            void apiFetch<{ session: { id: string } | null }>(
              "/api/agents/binary-deploy/active",
              { cacheTtlMs: 0 },
            )
              .then((snap) => {
                if (snap.session?.id) setDeploySessionId(snap.session.id);
              })
              .catch(() => {});
          }}
        />

        <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          <div className="border-b border-white/10 px-4 py-2 text-xs uppercase text-white/45">
            Enrolled agents
          </div>
          <table className="w-full border-collapse text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase text-white/50">
              <tr>
                <th className="px-4 py-3">Hostname</th>
                <th className="px-4 py-3">OS</th>
                <th className="px-4 py-3">Enrolled</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Packages</th>
                <th className="px-4 py-3">Updates</th>
                <th className="px-4 py-3">Kernel</th>
                <th className="px-4 py-3">CVEs</th>
                <th className="px-4 py-3">CrowdSec</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const targetBuild = release?.manifest
                  ? `${release.manifest.version}+${release.manifest.buildId}`.toLowerCase()
                  : "";
                const currentBuild = (a.version ?? "").toLowerCase();
                const outdatedBuild = !!targetBuild && a.online && currentBuild !== targetBuild;
                const binaryUpgrading = !!a.binaryUpgradeInProgress;
                const binaryPending = outdatedBuild && !binaryUpgrading && !a.binaryUpgradeLastError;
                const showProgress =
                  a.upgradeInProgress || binaryUpgrading || binaryPending || !!a.binaryUpgradeLastError;
                return (
                <Fragment key={a.id}>
                  <tr className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3 font-medium">
                    <Link className="text-[hsl(var(--accent))]" href={`/agents/${a.id}`}>
                      {a.hostname}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <OsInfo
                      osType={a.osType}
                      osDetail={a.osDetail}
                      variant="compact"
                    />
                  </td>
                  <td className="px-4 py-3 text-xs text-white/60">
                    {a.enrolledAt
                      ? new Date(a.enrolledAt).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        a.upgradeInProgress || binaryUpgrading
                          ? "text-amber-300"
                          : a.binaryUpgradeLastError
                            ? "text-red-400"
                            : a.online
                              ? "text-emerald-400"
                              : "text-amber-300"
                      }
                    >
                      {a.upgradeInProgress || binaryUpgrading
                        ? "upgrading"
                        : a.binaryUpgradeLastError
                          ? "upgrade failed"
                          : outdatedBuild
                            ? a.online
                              ? "update pending"
                              : "offline"
                            : a.online
                              ? "online"
                              : "stale/offline"}
                    </span>
                  </td>
                  <td className="px-4 py-3">{a._count?.packages ?? 0}</td>
                  <td className="px-4 py-3">
                    {(a.packageUpdatesPending ?? 0) > 0 ? (
                      <span className="text-amber-300">
                        {a.packageUpdatesPending} outdated
                      </span>
                    ) : (
                      <span className="text-white/40">up to date</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {a.kernelUpdatePending ? (
                      <span className="text-amber-300" title={a.kernelRunning ?? undefined}>
                        update pending
                      </span>
                    ) : a.kernelRunning ? (
                      <span className="text-xs text-white/60">{a.kernelRunning}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {(a.cveCount ?? 0) > 0 ? (
                      <span
                        className={
                          (a.cveCriticalCount ?? 0) > 0
                            ? "text-red-300"
                            : "text-amber-300"
                        }
                      >
                        {a.cveCount}
                        {(a.cveCriticalCount ?? 0) > 0
                          ? ` (${a.cveCriticalCount} crit)`
                          : ""}
                      </span>
                    ) : (
                      <span className="text-white/40">none</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {a.crowdsecInstalled ? "reporting" : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-white/60">
                    {a.version ?? "unknown"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-xs text-white/70 hover:bg-white/10"
                        onClick={() => openRename(a)}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                        disabled={deletingId === a.id}
                        onClick={() => void removeAgent(a)}
                      >
                        {deletingId === a.id ? "Removing…" : "Delete"}
                      </button>
                    </div>
                  </td>
                  </tr>
                  {showProgress ? (
                    <tr className="border-t border-white/5">
                      <td colSpan={11} className="px-4 py-2">
                        <div className="rounded-md bg-white/5 p-2">
                          <div className="text-xs text-amber-200">
                            {a.upgradeInProgress
                              ? "Package upgrade running…"
                              : binaryUpgrading
                                ? "Upgrading agent binary…"
                                : a.binaryUpgradeLastError
                                  ? `Agent binary update failed: ${a.binaryUpgradeLastError}`
                                  : binaryPending
                                    ? "Waiting for agent heartbeat to start binary update (~15s)…"
                                    : "Update status"}
                          </div>
                          <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-white/10">
                            <div
                              className={`h-full rounded bg-[hsl(var(--accent))] ${
                                a.binaryUpgradeLastError
                                  ? "w-full bg-red-500"
                                  : binaryUpgrading || a.upgradeInProgress
                                    ? "w-2/3 animate-pulse"
                                    : binaryPending
                                      ? "w-1/4 animate-pulse opacity-70"
                                      : "w-full"
                              }`}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )})}
              {!rows.length ? (
                <tr>
                  <td className="px-4 py-6 text-white/60" colSpan={11}>
                    No agents enrolled yet — expand <strong>Enroll new agent</strong> above to mint a token and install.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

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
                  onClick={() => setRenaming(null)}
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

        <BinaryDeployConsole
          open={consoleOpen}
          sessionId={deploySessionId}
          onClose={() => setConsoleOpen(false)}
        />
      </div>
    </Shell>
  );
}
