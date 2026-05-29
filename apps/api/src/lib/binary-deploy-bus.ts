import { randomUUID } from "node:crypto";
import { agentMatchesReleaseBuild } from "./binary-upgrade-reconcile.js";

export type BinaryDeployPhase =
  | "queued"
  | "notify"
  | "download"
  | "verify"
  | "install"
  | "restart"
  | "online"
  | "failed"
  | "info";

export type BinaryDeployEventLevel = "info" | "warn" | "error" | "success";

export type BinaryDeployEvent = {
  id: string;
  at: string;
  agentId?: string;
  hostname?: string;
  buildId: string;
  phase: BinaryDeployPhase;
  level: BinaryDeployEventLevel;
  message: string;
};

export type BinaryDeploySession = {
  id: string;
  buildId: string;
  version: string;
  startedAt: string;
  finishedAt?: string | null;
  startedBy?: string | null;
  targetHostnames: string[];
  status: "running" | "completed" | "failed";
  events: BinaryDeployEvent[];
};

const MAX_SESSIONS = 12;
const MAX_EVENTS_PER_SESSION = 600;

const sessions: BinaryDeploySession[] = [];
let activeSessionId: string | null = null;

function trimSessions() {
  while (sessions.length > MAX_SESSIONS) {
    sessions.pop();
  }
}

function findSession(sessionId?: string | null): BinaryDeploySession | null {
  if (sessionId) {
    return sessions.find((s) => s.id === sessionId) ?? null;
  }
  if (activeSessionId) {
    return sessions.find((s) => s.id === activeSessionId) ?? null;
  }
  return sessions[0] ?? null;
}

function findSessionByBuild(buildId: string): BinaryDeploySession | null {
  const key = buildId.toLowerCase().trim();
  const running = sessions.find(
    (s) => s.buildId.toLowerCase().trim() === key && s.status === "running",
  );
  if (running) return running;
  return sessions.find((s) => s.buildId.toLowerCase().trim() === key) ?? null;
}

function mergeTargetHostnames(
  session: BinaryDeploySession,
  hostnames: string[],
): void {
  const set = new Set(session.targetHostnames);
  for (const h of hostnames) {
    const trimmed = h.trim();
    if (trimmed) set.add(trimmed);
  }
  session.targetHostnames = [...set];
}

export function supersedeBinaryDeploySessions(newBuildId: string): void {
  const key = newBuildId.toLowerCase().trim();
  for (const session of sessions) {
    if (session.buildId.toLowerCase().trim() === key) continue;
    if (session.status !== "running") continue;
    session.status = "completed";
    session.finishedAt = new Date().toISOString();
    appendBinaryDeployEvent({
      sessionId: session.id,
      buildId: session.buildId,
      phase: "info",
      level: "warn",
      message: `Rollout superseded by controller build ${newBuildId}`,
    });
  }
  if (activeSessionId) {
    const active = sessions.find((s) => s.id === activeSessionId);
    if (active && active.buildId.toLowerCase().trim() !== key) {
      activeSessionId = null;
    }
  }
}

/** Reuse or create an in-memory session for a controller build rollout. */
export function ensureBinaryDeploySession(input: {
  buildId: string;
  version: string;
  targetHostnames?: string[];
  startedBy?: string | null;
}): BinaryDeploySession {
  supersedeBinaryDeploySessions(input.buildId);
  const existing = findSessionByBuild(input.buildId);
  if (existing) {
    if (input.targetHostnames?.length) {
      mergeTargetHostnames(existing, input.targetHostnames);
    }
    if (existing.status !== "running" && input.targetHostnames?.length) {
      existing.status = "running";
      existing.finishedAt = null;
    }
    activeSessionId = existing.id;
    return existing;
  }
  return startBinaryDeploySession({
    buildId: input.buildId,
    version: input.version,
    startedBy: input.startedBy ?? null,
    targetHostnames: input.targetHostnames ?? [],
  });
}

export function startBinaryDeploySession(input: {
  buildId: string;
  version: string;
  startedBy?: string | null;
  targetHostnames: string[];
}): BinaryDeploySession {
  const session: BinaryDeploySession = {
    id: randomUUID(),
    buildId: input.buildId,
    version: input.version,
    startedAt: new Date().toISOString(),
    startedBy: input.startedBy ?? null,
    targetHostnames: input.targetHostnames,
    status: "running",
    events: [],
  };
  sessions.unshift(session);
  activeSessionId = session.id;
  trimSessions();
  appendBinaryDeployEvent({
    sessionId: session.id,
    buildId: session.buildId,
    phase: "queued",
    level: "info",
    message: `Deployment started for ${session.version}+${session.buildId}`,
  });
  return session;
}

export function appendBinaryDeployEvent(input: {
  sessionId?: string | null;
  buildId?: string | null;
  version?: string | null;
  agentId?: string | null;
  hostname?: string | null;
  phase?: BinaryDeployPhase;
  level?: BinaryDeployEventLevel;
  message: string;
}): BinaryDeployEvent | null {
  let session =
    findSession(input.sessionId) ??
    (input.buildId ? findSessionByBuild(input.buildId) : null);

  if (!session && input.buildId?.trim()) {
    session = ensureBinaryDeploySession({
      buildId: input.buildId.trim(),
      version: (input.version ?? "0.4.0").trim() || "0.4.0",
      targetHostnames: input.hostname ? [input.hostname] : [],
    });
  }
  if (!session) return null;

  if (input.hostname) {
    mergeTargetHostnames(session, [input.hostname]);
  }

  const event: BinaryDeployEvent = {
    id: randomUUID(),
    at: new Date().toISOString(),
    agentId: input.agentId ?? undefined,
    hostname: input.hostname ?? undefined,
    buildId: session.buildId,
    phase: input.phase ?? "info",
    level: input.level ?? "info",
    message: input.message,
  };

  session.events.push(event);
  if (session.events.length > MAX_EVENTS_PER_SESSION) {
    session.events.splice(0, session.events.length - MAX_EVENTS_PER_SESSION);
  }
  return event;
}

export function getBinaryDeploySession(sessionId?: string | null) {
  return findSession(sessionId);
}

export function getActiveBinaryDeploySession() {
  return findSession(activeSessionId);
}

export function listBinaryDeploySessions(limit = 8) {
  return sessions.slice(0, limit);
}

export type BinaryDeployAgentState =
  | "pending"
  | "upgrading"
  | "success"
  | "failed"
  | "offline";

export function agentDeployState(input: {
  hostname: string;
  online: boolean;
  version: string | null | undefined;
  binaryUpgradeInProgress: boolean;
  binaryUpgradeLastError: string | null | undefined;
  binaryUpgradeForcedBuildId?: string | null;
  targetBuildId: string;
}): BinaryDeployAgentState {
  const target = input.targetBuildId.toLowerCase().trim();
  const forced = (input.binaryUpgradeForcedBuildId ?? "").toLowerCase().trim();

  const onTarget = agentMatchesReleaseBuild(input.version, null, target);
  if (onTarget && (!forced || forced === target)) return "success";

  // Controller published a newer build than this deploy session tracks.
  if (forced && forced !== target) {
    if (input.binaryUpgradeInProgress) return "upgrading";
    if (input.binaryUpgradeLastError?.trim()) return "failed";
    return input.online ? "pending" : "offline";
  }

  if (input.binaryUpgradeInProgress) return "upgrading";
  if (input.binaryUpgradeLastError?.trim()) {
    // Only count errors tied to this rollout (forced build matches target).
    if (!forced || forced === target) return "failed";
  }
  // Agent may be offline briefly while systemd restarts during upgrade.
  if (!input.online) {
    if (forced === target && target && !onTarget) {
      return "pending";
    }
    return "offline";
  }
  return "pending";
}

export function refreshBinaryDeploySessionStatus(
  session: BinaryDeploySession,
  agents: Array<{
    hostname: string;
    online: boolean;
    version: string | null;
    binaryUpgradeInProgress: boolean;
    binaryUpgradeLastError: string | null;
    binaryUpgradeForcedBuildId?: string | null;
  }>,
) {
  if (session.status !== "running") return session;

  const targets = new Set(session.targetHostnames);
  const relevant = agents.filter((a) => targets.has(a.hostname));
  if (!relevant.length) return session;

  const states = relevant.map((a) =>
    agentDeployState({
      hostname: a.hostname,
      online: a.online,
      version: a.version,
      binaryUpgradeInProgress: a.binaryUpgradeInProgress,
      binaryUpgradeLastError: a.binaryUpgradeLastError,
      binaryUpgradeForcedBuildId: a.binaryUpgradeForcedBuildId,
      targetBuildId: session.buildId,
    }),
  );

  const allSuccess = states.every((s) => s === "success");
  const anyFailed = states.some((s) => s === "failed");
  const anyUpgrading = states.some((s) => s === "upgrading");
  const anyPending = states.some((s) => s === "pending");
  const terminal = states.every(
    (s) => s === "success" || s === "failed" || s === "offline",
  );

  const startedMs = Date.parse(session.startedAt);
  const minRunMs = Number(process.env.BINARY_DEPLOY_MIN_MS ?? 30_000);
  const ranLongEnough =
    Number.isFinite(startedMs) && Date.now() - startedMs >= minRunMs;

  if (anyUpgrading || anyPending) return session;

  if (allSuccess && ranLongEnough) {
    session.status = "completed";
    session.finishedAt = new Date().toISOString();
    appendBinaryDeployEvent({
      sessionId: session.id,
      buildId: session.buildId,
      phase: "online",
      level: "success",
      message: `Deployment finished (${relevant.length}/${relevant.length} agents on ${session.buildId})`,
    });
    return session;
  }

  if (terminal && anyFailed && ranLongEnough) {
    session.status = "failed";
    session.finishedAt = new Date().toISOString();
    const ok = states.filter((s) => s === "success").length;
    appendBinaryDeployEvent({
      sessionId: session.id,
      buildId: session.buildId,
      phase: "failed",
      level: "warn",
      message: `Deployment finished with failures (${ok}/${relevant.length} succeeded)`,
    });
  }

  return session;
}

export function noteBinaryDeployHeartbeatSuccess(input: {
  agentId: string;
  hostname: string;
  buildId: string;
  version: string;
}) {
  const plus = input.version.indexOf("+");
  const semver = plus > 0 ? input.version.slice(0, plus) : input.version;
  appendBinaryDeployEvent({
    buildId: input.buildId,
    version: semver,
    agentId: input.agentId,
    hostname: input.hostname,
    phase: "online",
    level: "success",
    message: `${input.hostname} is online on ${input.version}`,
  });
}

export function noteBinaryDeployFailure(input: {
  agentId: string;
  hostname: string;
  buildId?: string | null;
  version?: string | null;
  message: string;
}) {
  const bid = input.buildId?.trim();
  if (bid) {
    const session = findSessionByBuild(bid);
    if (session && session.status !== "running") {
      session.status = "running";
      session.finishedAt = null;
      activeSessionId = session.id;
    }
  }
  appendBinaryDeployEvent({
    buildId: input.buildId,
    version: input.version,
    agentId: input.agentId,
    hostname: input.hostname,
    phase: "failed",
    level: "error",
    message: `${input.hostname}: ${input.message}`,
  });
}

export function synthesizeDeployEventsFromAgents(
  session: BinaryDeploySession,
  agents: Array<{
    hostname: string;
    binaryUpgradeInProgress: boolean;
    binaryUpgradeLastError: string | null;
    binaryUpgradeForcedBuildId?: string | null;
    deployState: BinaryDeployAgentState;
  }>,
): BinaryDeployEvent[] {
  const target = session.buildId.toLowerCase().trim();
  const out: BinaryDeployEvent[] = [];
  for (const a of agents) {
    if (a.binaryUpgradeInProgress) {
      out.push({
        id: `syn-${a.hostname}-upgrading`,
        at: new Date().toISOString(),
        hostname: a.hostname,
        buildId: session.buildId,
        phase: "install",
        level: "info",
        message: `${a.hostname}: binary upgrade in progress`,
      });
    } else if (a.binaryUpgradeLastError?.trim() && a.deployState === "failed") {
      const forced = (a.binaryUpgradeForcedBuildId ?? "").toLowerCase().trim();
      if (forced && forced !== target) continue;
      out.push({
        id: `syn-${a.hostname}-failed`,
        at: new Date().toISOString(),
        hostname: a.hostname,
        buildId: session.buildId,
        phase: "failed",
        level: "error",
        message: `${a.hostname}: ${a.binaryUpgradeLastError.trim()}`,
      });
    } else if (a.deployState === "pending") {
      out.push({
        id: `syn-${a.hostname}-pending`,
        at: new Date().toISOString(),
        hostname: a.hostname,
        buildId: session.buildId,
        phase: "queued",
        level: "info",
        message: `${a.hostname}: waiting to apply ${session.version}+${session.buildId}`,
      });
    } else if (a.deployState === "success") {
      out.push({
        id: `syn-${a.hostname}-ok`,
        at: new Date().toISOString(),
        hostname: a.hostname,
        buildId: session.buildId,
        phase: "online",
        level: "success",
        message: `${a.hostname}: on target build`,
      });
    }
  }
  return out;
}

export function mergeDeployEventLog(
  session: BinaryDeploySession,
  agents: Array<{
    hostname: string;
    binaryUpgradeInProgress: boolean;
    binaryUpgradeLastError: string | null;
    deployState: BinaryDeployAgentState;
  }>,
): BinaryDeployEvent[] {
  const synthesized = synthesizeDeployEventsFromAgents(session, agents);
  if (!session.events.length) return synthesized;
  const seen = new Set(
    session.events.map((e) => `${e.hostname ?? ""}:${e.phase}:${e.level}`),
  );
  const extra = synthesized.filter(
    (e) => !seen.has(`${e.hostname ?? ""}:${e.phase}:${e.level}`),
  );
  return [...session.events, ...extra];
}
