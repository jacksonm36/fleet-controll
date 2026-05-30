/** Normalize cscli / LAPI alert and decision JSON for the federated UI. */

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

export type CrowdSecStatusExtended = {
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

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function pickString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function pickNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function geoFromSource(source: Record<string, unknown> | null): {
  country: string;
  asName: string;
} {
  if (!source) return { country: "", asName: "" };
  const country = pickString(
    source.cn,
    source.country,
    source.Country,
    source.iso,
  );
  const asName = pickString(
    source.as_name,
    source.asName,
    source.as_number_name,
    source.ASName,
    source.asn,
  );
  const asNum = pickString(source.as_number, source.ASNumber);
  const asLabel =
    asName && asNum ? `${asName} (${asNum})` : asName || asNum || "";
  return { country, asName: asLabel };
}

function metaValue(meta: unknown[], key: string): string {
  for (const item of meta) {
    const row = asRecord(item);
    if (!row) continue;
    if (row.key === key || row.Key === key) {
      return pickString(row.value, row.Value);
    }
  }
  return "";
}

function firstEvent(alert: Record<string, unknown>): Record<string, unknown> | null {
  const events = asArray(alert.events);
  return asRecord(events[0]) ?? null;
}

function looksLikeFlatDecision(rec: Record<string, unknown>): boolean {
  const scope = pickString(rec.scope, rec.Scope);
  const value = pickString(rec.value, rec.Value);
  return !!(scope && value);
}

function nestedDecisions(alert: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["decisions", "Decisions"]) {
    const items = asArray(alert[key]);
    if (!items.length) continue;
    const out: Record<string, unknown>[] = [];
    for (const item of items) {
      const row = asRecord(item);
      if (row) out.push(row);
    }
    if (out.length) return out;
  }
  return [];
}

function mergeAlertDecision(
  alert: Record<string, unknown>,
  decision: Record<string, unknown>,
): Record<string, unknown> {
  const sourceObj = asRecord(alert.source);
  const geo = geoFromSource(sourceObj);
  const ev = firstEvent(alert);
  const evMeta = asArray(ev?.meta);

  return {
    ...decision,
    scenario: pickString(decision.scenario, decision.Scenario, alert.scenario),
    source: decision.source ?? alert.source,
    linkedAlertId: pickString(decision.alertId, alert.id, alert.ID),
    eventsCount: pickNumber(
      alert.events_count,
      alert.eventsCount,
      alert.EventsCount,
    ),
    simulated: alert.simulated === true || alert.Simulated === true,
    country: geo.country,
    asName: geo.asName,
    httpMethod: pickString(
      metaValue(evMeta, "method"),
      metaValue(asArray(alert.meta), "method"),
    ),
  };
}

/** cscli decisions list -o json returns alert rows with nested decisions[]. */
export function flattenCrowdSecDecisions(raw: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const item of asArray(raw)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const nested = nestedDecisions(rec);
    if (nested.length) {
      for (const d of nested) {
        out.push(mergeAlertDecision(rec, d));
      }
      continue;
    }
    if (looksLikeFlatDecision(rec)) {
      out.push(rec);
    }
  }
  return out;
}

export function countCrowdSecDecisions(payload: unknown): number {
  const p = asRecord(payload);
  if (!p) return 0;
  const flat = flattenCrowdSecDecisions(p.decisions);
  if (flat.length) return flat.length;
  return asArray(p.decisions).length;
}

function sourceFromDecision(d: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(d.source);
}

export function parseCrowdSecAlert(
  alert: unknown,
  ctx: { agentId: string; hostname: string; capturedAt: Date | string },
): CrowdSecAlertRow {
  const a = asRecord(alert) ?? {};
  const ev = firstEvent(a);
  const evMeta = asArray(ev?.meta);
  const topMeta = asArray(a.meta);

  const sourceObj = asRecord(a.source);
  const scenario = pickString(
    a.scenario,
    a.Scenario,
    ev?.scenario,
    metaValue(topMeta, "scenario"),
  );

  const source = pickString(
    sourceObj?.ip,
    sourceObj?.range,
    sourceObj?.value,
    a["source-ip"],
    a.source_ip,
    metaValue(evMeta, "source_ip"),
    metaValue(evMeta, "source-range"),
    metaValue(topMeta, "source_ip"),
    metaValue(topMeta, "source-range"),
  );

  const target = pickString(
    metaValue(evMeta, "http_path"),
    metaValue(evMeta, "target_uri"),
    metaValue(evMeta, "uri"),
    metaValue(topMeta, "target_uri"),
    metaValue(topMeta, "http_path"),
    ev?.target_uri,
    a.target_uri,
  );

  const message = pickString(
    a.message,
    a.Message,
    metaValue(evMeta, "message"),
    scenario,
    target,
  );

  const geo = geoFromSource(sourceObj);
  const method = pickString(
    metaValue(evMeta, "method"),
    metaValue(topMeta, "method"),
  );
  const events = pickNumber(a.events_count, a.eventsCount, a.EventsCount);

  const alertAtRaw = pickString(
    a.created_at,
    a.CreatedAt,
    a.start_at,
    a.StartDate,
    ev?.timestamp,
    ev?.time,
  );

  return {
    agentId: ctx.agentId,
    hostname: ctx.hostname,
    capturedAt:
      ctx.capturedAt instanceof Date
        ? ctx.capturedAt.toISOString()
        : String(ctx.capturedAt),
    alertId: pickString(a.id, a.ID) || "—",
    scenario: scenario || "—",
    source: source || "—",
    target: target.length > 120 ? `${target.slice(0, 117)}…` : target || "—",
    message: message || "—",
    method: method || "—",
    country: geo.country || "—",
    asName: geo.asName || "—",
    events,
    alertAt: alertAtRaw || null,
    raw: a,
  };
}

export function parseCrowdSecDecision(
  decision: unknown,
  ctx: { agentId: string; hostname: string; capturedAt: Date | string },
): CrowdSecDecisionRow {
  const d = asRecord(decision) ?? {};
  const sourceObj = sourceFromDecision(d);

  const scope = pickString(d.scope, d.Scope);
  const value = pickString(
    d.value,
    d.Value,
    d.ip,
    sourceObj?.ip,
    sourceObj?.range,
    sourceObj?.value,
  );
  const geo = geoFromSource(sourceObj);
  const country =
    pickString(d.country, d.Country) || geo.country;
  const asName = pickString(d.asName, d.as_name) || geo.asName;
  const typeRaw = pickString(d.type, d.Type, d.action, d.Action);
  const simulated =
    d.simulated === true ||
    typeRaw.startsWith("(simul)") ||
    typeRaw.includes("simul");

  return {
    agentId: ctx.agentId,
    hostname: ctx.hostname,
    capturedAt:
      ctx.capturedAt instanceof Date
        ? ctx.capturedAt.toISOString()
        : String(ctx.capturedAt),
    decisionId: pickString(d.id, d.ID) || "—",
    linkedAlertId: pickString(d.linkedAlertId, d.alertId) || "—",
    scope: scope || "—",
    value: value || "—",
    type: typeRaw.replace(/^\(simul\)/, "") || "—",
    duration: pickString(
      d.duration,
      d.Duration,
      d.expiration,
      d.until,
      d.Until,
    ) || "—",
    scenario: pickString(d.scenario, d.Scenario, d.reason, d.Reason) || "—",
    origin: pickString(d.origin, d.Origin, d.source_label) || "—",
    country: country || "—",
    asName: asName || "—",
    events: pickNumber(d.eventsCount, d.events_count, d.eventsCount),
    simulated,
    raw: d,
  };
}

export function summarizeCrowdSecPayload(
  payload: unknown,
  ctx: {
    agentId: string;
    hostname: string;
    osType: string;
    osDetail: string | null;
    online: boolean;
    crowdsecInstalled: boolean;
    capturedAt: Date | null;
    lastSeenAt: Date | null;
  },
): CrowdSecAgentRow {
  const p = asRecord(payload);
  const alerts = p ? asArray(p.alerts) : [];
  const decisionCount = p ? countCrowdSecDecisions(p) : 0;
  const reporting =
    !!p &&
    (alerts.length > 0 || decisionCount > 0 || p.healthy === true);

  let snapshotNote: string | null = null;
  if (!reporting) {
    if (!ctx.crowdsecInstalled) {
      snapshotNote = "cscli not detected on host";
    } else if (!ctx.online) {
      snapshotNote = "Agent offline";
    } else if (!ctx.capturedAt) {
      snapshotNote = "Awaiting first snapshot";
    } else {
      snapshotNote = "Empty snapshot";
    }
  }

  return {
    agentId: ctx.agentId,
    hostname: ctx.hostname,
    osType: ctx.osType,
    osDetail: ctx.osDetail,
    online: ctx.online,
    crowdsecInstalled: ctx.crowdsecInstalled,
    reporting,
    healthy: p?.healthy === true,
    version: pickString(p?.version) || null,
    capturedAt: ctx.capturedAt?.toISOString() ?? null,
    lastSeenAt: ctx.lastSeenAt?.toISOString() ?? null,
    alertCount: alerts.length,
    decisionCount,
    snapshotNote,
  };
}

export function buildCrowdSecStatus(
  snapshots: { payload: unknown }[],
  agents: { online: boolean }[],
  enrolledCount: number,
): CrowdSecStatusExtended {
  let healthyHosts = 0;
  let alertTotal = 0;
  let decisionTotal = 0;
  let banCount = 0;
  let captchaCount = 0;
  const uniqueValues = new Set<string>();

  for (const s of snapshots) {
    const p = asRecord(s.payload);
    if (!p) continue;
    if (p.healthy === true) healthyHosts++;
    alertTotal += asArray(p.alerts).length;
    const flat = flattenCrowdSecDecisions(p.decisions);
    decisionTotal += flat.length;
    for (const d of flat) {
      const row = parseCrowdSecDecision(d, {
        agentId: "",
        hostname: "",
        capturedAt: new Date(),
      });
      const val = row.value;
      if (val && val !== "—") uniqueValues.add(val);
      const t = row.type.toLowerCase();
      if (t.includes("captcha")) captchaCount++;
      else if (t.includes("ban")) banCount++;
    }
  }

  const reportingAgents = snapshots.length;
  const onlineAgents = agents.filter((a) => a.online).length;

  return {
    snapshotHosts: snapshots.length,
    healthyHosts,
    alertTotal,
    decisionTotal,
    enrolledAgents: enrolledCount,
    reportingAgents,
    pendingAgents: Math.max(0, enrolledCount - reportingAgents),
    onlineAgents,
    uniqueDecisionValues: uniqueValues.size,
    banCount,
    captchaCount,
  };
}
