export type CrowdSecStatus = {
  snapshotHosts: number;
  healthyHosts: number;
  alertTotal: number;
  decisionTotal: number;
  enrolledAgents: number;
  reportingAgents: number;
  pendingAgents: number;
  onlineAgents: number;
  uniqueDecisionValues: number;
  banCount: number;
  captchaCount: number;
};

export type CrowdSecAgentRow = {
  agentId: string;
  hostname: string;
  osType: string;
  osDetail: string | null;
  online: boolean;
  crowdsecInstalled: boolean;
  reporting: boolean;
  healthy: boolean;
  version: string | null;
  capturedAt: string | null;
  lastSeenAt: string | null;
  alertCount: number;
  decisionCount: number;
  snapshotNote: string | null;
};

export type CrowdSecAgentsResponse = {
  agents: CrowdSecAgentRow[];
  reportingCount: number;
  notReportingCount: number;
};

export type CrowdSecAlertRow = {
  agentId: string;
  hostname: string;
  capturedAt: string;
  alertId: string;
  scenario: string;
  source: string;
  target: string;
  message: string;
  method: string;
  country: string;
  asName: string;
  events: number | null;
  alertAt: string | null;
  raw: Record<string, unknown>;
};

export type CrowdSecDecisionRow = {
  agentId: string;
  hostname: string;
  capturedAt: string;
  decisionId: string;
  linkedAlertId: string;
  scope: string;
  value: string;
  type: string;
  duration: string;
  scenario: string;
  origin: string;
  country: string;
  asName: string;
  events: number | null;
  simulated: boolean;
  raw: Record<string, unknown>;
};

/** DB row `{ payload, capturedAt }` or flat CrowdSec snapshot v1 body. */
export function unwrapCrowdSecSnapshot(raw: unknown): {
  healthy?: boolean;
  version?: string;
  capturedAt?: string;
  alerts: unknown[];
  decisions: unknown[];
} | null {
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const inner =
    r.payload != null && typeof r.payload === "object"
      ? (r.payload as Record<string, unknown>)
      : r;
  const alerts = Array.isArray(inner.alerts) ? inner.alerts : [];
  const decisions = Array.isArray(inner.decisions) ? inner.decisions : [];
  if (
    !r.payload &&
    alerts.length === 0 &&
    decisions.length === 0 &&
    inner.healthy !== true &&
    !inner.version
  ) {
    return null;
  }
  return {
    healthy: inner.healthy === true ? true : inner.healthy === false ? false : undefined,
    version:
      typeof inner.version === "string" ? formatCscliVersion(inner.version) : undefined,
    capturedAt:
      r.capturedAt != null
        ? String(r.capturedAt)
        : typeof inner.capturedAt === "string"
          ? inner.capturedAt
          : undefined,
    alerts,
    decisions,
  };
}

export function countSnapshotDecisions(decisions: unknown[]): number {
  let flat = 0;
  for (const item of decisions) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    const nested = d.decisions;
    if (Array.isArray(nested) && nested.length > 0) {
      flat += nested.length;
      continue;
    }
    if (d.scope != null || d.value != null || d.type != null) flat += 1;
  }
  return flat > 0 ? flat : decisions.length;
}

export function formatCscliVersion(raw: string): string {
  const line = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  const s = (line ?? raw.trim()) || "—";
  if (s.length > 80) return `${s.slice(0, 77)}…`;
  return s;
}

export function formatCrowdSecTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function actionBadgeClass(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("captcha")) {
    return "border-violet-500/35 bg-violet-500/15 text-violet-200";
  }
  if (t.includes("ban")) {
    return "border-red-500/35 bg-red-500/15 text-red-200";
  }
  return "border-white/15 bg-white/5 text-white/70";
}

export function agentPostureLabel(row: CrowdSecAgentRow): {
  label: string;
  tone: "ok" | "warn" | "muted" | "offline";
  detail?: string;
} {
  if (!row.online) {
    return {
      label: "Agent offline",
      tone: "offline",
      detail: row.snapshotNote ?? undefined,
    };
  }
  if (!row.reporting) {
    return {
      label: row.crowdsecInstalled ? "No snapshot" : "Not reporting",
      tone: "warn",
      detail: row.snapshotNote ?? undefined,
    };
  }
  if (!row.healthy) return { label: "Unhealthy", tone: "warn" };
  return { label: "Reporting", tone: "ok" };
}
