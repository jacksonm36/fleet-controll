/** Classify inventory service rows for monitoring / alerts (not raw DB state). */

export type ServiceHealthRow = {
  name: string;
  kind: string;
  state: string;
  enabled?: boolean | null;
  detail?: string | null;
};

const SYSTEMD_HEALTHY_ACTIVE = new Set([
  "active",
  "activating",
  "reloading",
]);

const DAEMON_UNIT_TYPES = new Set([
  "notify",
  "simple",
  "forking",
  "dbus",
  "exec",
]);

/** Parsed from agent detail: `type=oneshot · sub=exited · file=enabled` */
export function parseSystemdDetail(detail?: string | null): {
  type?: string;
  sub?: string;
  file?: string;
} {
  if (!detail) return {};
  const out: { type?: string; sub?: string; file?: string } = {};
  for (const part of detail.split("·")) {
    const token = part.trim();
    const [k, v] = token.split("=");
    if (!v) continue;
    switch (k.trim()) {
      case "type":
        out.type = v.trim().toLowerCase();
        break;
      case "sub":
        out.sub = v.trim().toLowerCase();
        break;
      case "file":
        out.file = v.trim().toLowerCase();
        break;
    }
  }
  return out;
}

/** Units that are often inactive/dead while the host is healthy (name heuristics). */
function isLikelyTransientSystemdUnit(name: string): boolean {
  const n = name.toLowerCase();
  const patterns = [
    /^apt-/,
    /^dpkg-/,
    /-wait-online\.service$/,
    /-wait\.service$/,
    /dispatcher\.service$/,
    /^autovt@/,
    /^systemd-/,
    /@\.service$/,
    /\.socket$/,
    /\.mount$/,
    /\.timer$/,
    /weekly\.service$/,
    /daily\.service$/,
    /^fstrim/,
    /^logrotate/,
    /^man-db/,
    /^plocate/,
    /^update-notifier/,
    /^fwupd-/,
    /^ua-/,
    /^motd-news/,
    /^e2scrub/,
    /^grub-/,
  ];
  return patterns.some((p) => p.test(n));
}

export function serviceNeedsAttention(row: ServiceHealthRow): boolean {
  const state = (row.state ?? "").trim().toLowerCase();
  const kind = (row.kind ?? "").trim().toLowerCase();

  switch (kind) {
    case "systemd": {
      const meta = parseSystemdDetail(row.detail);
      if (state === "failed" || meta.sub === "failed") return true;
      if (SYSTEMD_HEALTHY_ACTIVE.has(state)) return false;

      const unitType = meta.type ?? "";
      const unitFile = meta.file ?? "";

      if (state === "exited") {
        if (unitType === "oneshot" || unitType === "mount") return false;
        return false;
      }
      if (
        unitFile === "masked" ||
        unitFile === "disabled" ||
        unitFile === "static"
      ) {
        return false;
      }
      if (row.enabled !== true) return false;

      if (unitType === "oneshot" || unitType === "mount" || unitType === "idle") {
        return false;
      }
      if (DAEMON_UNIT_TYPES.has(unitType)) {
        return state === "inactive" || state === "dead";
      }
      if (state === "inactive" || state === "dead") {
        return !isLikelyTransientSystemdUnit(row.name);
      }
      return false;
    }
    case "windows_service":
      return state !== "running";
    case "snap":
      return state !== "active";
    case "launchd":
      return state === "not running";
    default:
      return state === "failed";
  }
}

export function filterServicesNeedingAttention<T extends ServiceHealthRow>(
  rows: T[],
): T[] {
  return rows.filter((row) => {
    const r = row as ServiceHealthRow & { needsAttention?: boolean };
    if (r.needsAttention === true) return true;
    if (r.needsAttention === false) return false;
    return serviceNeedsAttention(row);
  });
}
