"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";

type DeployEvent = {
  id: string;
  at: string;
  agentId?: string;
  hostname?: string;
  buildId: string;
  phase: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
};

type DeployAgent = {
  id: string;
  hostname: string;
  online: boolean;
  version: string | null;
  binaryUpgradeInProgress: boolean;
  binaryUpgradeLastError: string | null;
  deployState: "pending" | "upgrading" | "success" | "failed" | "offline";
};

type DeploySession = {
  id: string;
  buildId: string;
  version: string;
  startedAt: string;
  finishedAt?: string | null;
  status: "running" | "completed" | "failed";
  targetHostnames: string[];
  events: DeployEvent[];
};

type DeploySnapshot = {
  session: DeploySession | null;
  agents: DeployAgent[];
};

function levelClass(level: DeployEvent["level"]): string {
  switch (level) {
    case "success":
      return "text-emerald-300";
    case "error":
      return "text-red-300";
    case "warn":
      return "text-amber-300";
    default:
      return "text-white/75";
  }
}

function stateClass(state: DeployAgent["deployState"]): string {
  switch (state) {
    case "success":
      return "text-emerald-400";
    case "upgrading":
      return "text-amber-300";
    case "failed":
      return "text-red-400";
    case "offline":
      return "text-white/40";
    default:
      return "text-white/60";
  }
}

function stateLabel(state: DeployAgent["deployState"]): string {
  switch (state) {
    case "success":
      return "Updated";
    case "upgrading":
      return "Upgrading";
    case "failed":
      return "Failed";
    case "offline":
      return "Offline";
    default:
      return "Waiting";
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString();
}

export function BinaryDeployConsole({
  open,
  onClose,
  sessionId,
}: {
  open: boolean;
  onClose: () => void;
  sessionId?: string | null;
}) {
  const [snapshot, setSnapshot] = useState<DeploySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const stickToBottom = useRef(true);

  const reload = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setLoadError(null);
    try {
      let data: DeploySnapshot | null = null;
      if (sessionId) {
        try {
          data = await apiFetch<DeploySnapshot>(
            `/api/agents/binary-deploy/${sessionId}`,
            { cacheTtlMs: 0 },
          );
        } catch {
          data = null;
        }
      }
      if (!data?.session) {
        data = await apiFetch<DeploySnapshot>(
          "/api/agents/binary-deploy/active",
          { cacheTtlMs: 0 },
        );
      }
      setSnapshot(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load deploy console");
    } finally {
      setLoading(false);
    }
  }, [open, sessionId]);

  useEffect(() => {
    if (!open) return;
    stickToBottom.current = true;
    void reload();
  }, [open, reload]);

  const pollMs =
    snapshot?.session?.status === "running" ||
    (snapshot?.agents.some((a) => a.deployState === "upgrading") ?? false)
      ? 2_000
      : 5_000;

  usePolling(
    () => {
      if (!open) return;
      void reload();
    },
    pollMs,
    !open,
  );

  useEffect(() => {
    if (!open || !logRef.current || !stickToBottom.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [open, snapshot?.session?.events.length]);

  const summary = useMemo(() => {
    const agents = snapshot?.agents ?? [];
    return {
      total: agents.length,
      success: agents.filter((a) => a.deployState === "success").length,
      upgrading: agents.filter((a) => a.deployState === "upgrading").length,
      failed: agents.filter((a) => a.deployState === "failed").length,
      pending: agents.filter((a) => a.deployState === "pending").length,
    };
  }, [snapshot?.agents]);

  if (!open) return null;

  const session = snapshot?.session;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="flex h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Agent deploy console</div>
            {session ? (
              <p className="mt-1 text-xs text-white/55">
                {session.version}+{session.buildId} · started{" "}
                {new Date(session.startedAt).toLocaleString()}
                {session.finishedAt
                  ? ` · finished ${new Date(session.finishedAt).toLocaleString()}`
                  : ""}{" "}
                ·{" "}
                <span
                  className={
                    session.status === "running"
                      ? "text-amber-300"
                      : session.status === "completed"
                        ? "text-emerald-400"
                        : "text-red-400"
                  }
                >
                  {session.status}
                </span>
              </p>
            ) : (
              <p className="mt-1 text-xs text-white/55">
                No deployment history yet. Use{" "}
                <strong className="font-medium text-white/70">
                  Push update to online agents
                </strong>{" "}
                to start a rollout (events stream here in real time).
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20"
              onClick={() => void reload()}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              className="rounded-md bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>

        {loadError ? (
          <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
            {loadError}
          </div>
        ) : null}

        {session ? (
          <div className="grid gap-2 border-b border-white/10 px-4 py-3 sm:grid-cols-5">
            <div className="rounded-md bg-black/20 px-3 py-2 text-xs">
              <div className="text-white/45">Targets</div>
              <div className="mt-0.5 text-lg font-semibold">{summary.total}</div>
            </div>
            <div className="rounded-md bg-black/20 px-3 py-2 text-xs">
              <div className="text-white/45">Updated</div>
              <div className="mt-0.5 text-lg font-semibold text-emerald-400">
                {summary.success}
              </div>
            </div>
            <div className="rounded-md bg-black/20 px-3 py-2 text-xs">
              <div className="text-white/45">Upgrading</div>
              <div className="mt-0.5 text-lg font-semibold text-amber-300">
                {summary.upgrading}
              </div>
            </div>
            <div className="rounded-md bg-black/20 px-3 py-2 text-xs">
              <div className="text-white/45">Waiting</div>
              <div className="mt-0.5 text-lg font-semibold">{summary.pending}</div>
            </div>
            <div className="rounded-md bg-black/20 px-3 py-2 text-xs">
              <div className="text-white/45">Failed</div>
              <div className="mt-0.5 text-lg font-semibold text-red-400">
                {summary.failed}
              </div>
            </div>
          </div>
        ) : null}

        {snapshot?.agents.length ? (
          <div className="max-h-28 overflow-auto border-b border-white/10 px-4 py-2">
            <div className="flex flex-wrap gap-2">
              {snapshot.agents.map((agent) => (
                <div
                  key={agent.id}
                  className="rounded-md border border-white/10 bg-black/20 px-2.5 py-1 text-xs"
                >
                  <span className="font-medium text-white/85">{agent.hostname}</span>
                  <span className={`ml-2 ${stateClass(agent.deployState)}`}>
                    {stateLabel(agent.deployState)}
                  </span>
                  {agent.version ? (
                    <span className="ml-2 font-mono text-[10px] text-white/40">
                      {agent.version}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <pre
          ref={logRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
          className="flex-1 overflow-auto bg-black/40 p-4 font-mono text-xs leading-relaxed"
        >
          {(session?.events ?? []).length ? (
            session!.events.map((event) => (
              <div key={event.id} className={levelClass(event.level)}>
                <span className="text-white/35">{formatTime(event.at)}</span>
                {event.hostname ? (
                  <span className="text-[hsl(var(--accent))]"> [{event.hostname}]</span>
                ) : null}
                <span> {event.message}</span>
              </div>
            ))
          ) : session?.status === "running" ? (
            <span className="text-white/45">
              Waiting for deployment events… (agents report download / install / restart
              here)
            </span>
          ) : session ? (
            <span className="text-white/45">
              No log lines stored for this deployment. Agent rows above reflect current
              state from the database.
            </span>
          ) : (
            <span className="text-white/45">No deployment session to display.</span>
          )}
        </pre>
      </div>
    </div>
  );
}
