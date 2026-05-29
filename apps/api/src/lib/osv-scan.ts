/**
 * Query Google OSV API for known vulnerabilities in installed OS packages.
 * https://google.osv.dev/
 */

export type OsvPackageInput = {
  name: string;
  version: string;
  manager: string;
};

export type OsvVulnHit = {
  cveId: string;
  packageName: string;
  packageVersion: string;
  manager: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  summary?: string;
  fixedVersion?: string;
  source: "osv";
};

const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
const OSV_VULN_URL = "https://api.osv.dev/v1/vulns";
const MAX_PACKAGES = 400;
const BATCH_SIZE = 100;
const VULN_FETCH_CONCURRENCY = 12;

/** Extract a canonical CVE-YYYY-NNNN id from OSV / distro-specific ids. */
export function normalizeCveId(raw: string): string | null {
  const id = raw.trim().toUpperCase();
  const direct = id.match(/^CVE-\d{4}-\d+$/);
  if (direct) return direct[0]!;
  const embedded = id.match(/CVE-\d{4}-\d+/);
  return embedded?.[0] ?? null;
}

export function looksLikeOsRelease(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return /^(NAME|ID|VERSION_ID)=/m.test(raw);
}

function inferDebianMajorFromPackages(
  packages: OsvPackageInput[],
): string | null {
  for (const p of packages) {
    const m = p.version.match(/(?:\+|~)?deb(\d+)/i);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function parseOsRelease(raw: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const line of raw.split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Map distro + package manager to an OSV ecosystem string. */
export function osvEcosystem(
  osType: string,
  osDetail: string | null | undefined,
  manager: string,
): string | null {
  const m = manager.toLowerCase();
  if (!["dpkg", "apt", "rpm", "dnf", "yum"].includes(m)) return null;
  if (osType !== "linux") return null;

  const rel = looksLikeOsRelease(osDetail) ? parseOsRelease(osDetail) : {};
  const id = (rel.ID ?? rel.ID_LIKE ?? "").toLowerCase();
  const ver = rel.VERSION_ID ?? "";

  if (id.includes("debian") || m === "dpkg") {
    if (ver) return `Debian:${ver.split(".")[0]}`;
    return "Debian:12";
  }
  if (id.includes("ubuntu")) {
    if (ver) return `Ubuntu:${ver}`;
    return "Ubuntu:22.04";
  }
  if (id.includes("rhel") || id.includes("centos") || id.includes("rocky") || id.includes("almalinux")) {
    if (ver) return `Red Hat:${ver.split(".")[0]}`;
    return "Red Hat:9";
  }
  if (id.includes("fedora")) {
    if (ver) return `Fedora:${ver}`;
    return null;
  }
  if (id.includes("alpine")) {
    if (ver) return `Alpine:${ver}`;
    return null;
  }
  if (m === "rpm" || m === "dnf" || m === "yum") {
    if (ver) return `Red Hat:${ver.split(".")[0]}`;
  }
  return null;
}

function cvssMetric(vector: string, key: string): string {
  const m = vector.match(new RegExp(`/${key}:([^/]+)`));
  return m?.[1] ?? "";
}

/** Approximate CVSS v3.x base severity from a vector string. */
function severityFromCvssVector(vector: string): OsvVulnHit["severity"] {
  if (!vector.includes("CVSS")) return "UNKNOWN";
  const av = cvssMetric(vector, "AV");
  const ac = cvssMetric(vector, "AC");
  const c = cvssMetric(vector, "C");
  const i = cvssMetric(vector, "I");
  const a = cvssMetric(vector, "A");
  const impacts = [c, i, a];
  const highCount = impacts.filter((x) => x === "H").length;
  if (av === "N" && ac === "L" && highCount >= 2) return "CRITICAL";
  if (av === "N" && highCount >= 1) return "HIGH";
  if (highCount >= 1) return "MEDIUM";
  if (impacts.some((x) => x === "L")) return "LOW";
  return "UNKNOWN";
}

function severityFromOsv(vuln: {
  severity?: { type?: string; score?: string }[];
  database_specific?: Record<string, unknown>;
}): OsvVulnHit["severity"] {
  const db = vuln.database_specific ?? {};
  const debian = db.severity as string | undefined;
  if (debian) {
    const u = debian.toUpperCase();
    if (u.includes("CRITICAL") || u === "RC") return "CRITICAL";
    if (u.includes("HIGH") || u === "HI") return "HIGH";
    if (u.includes("MEDIUM") || u === "MD") return "MEDIUM";
    if (u.includes("LOW") || u === "LO") return "LOW";
  }
  for (const s of vuln.severity ?? []) {
    const raw = s.score ?? "";
    const numeric = parseFloat(raw);
    if (!Number.isNaN(numeric)) {
      if (numeric >= 9) return "CRITICAL";
      if (numeric >= 7) return "HIGH";
      if (numeric >= 4) return "MEDIUM";
      if (numeric > 0) return "LOW";
    }
    const fromVector = severityFromCvssVector(raw);
    if (fromVector !== "UNKNOWN") return fromVector;
  }
  return "UNKNOWN";
}

function fixedVersionFromOsv(
  vuln: { affected?: { ranges?: { events?: { fixed?: string }[] }[] }[] },
): string | undefined {
  for (const aff of vuln.affected ?? []) {
    for (const range of aff.ranges ?? []) {
      for (const ev of range.events ?? []) {
        if (ev.fixed) return ev.fixed;
      }
    }
  }
  return undefined;
}

async function fetchOsvVulnDetails(
  osvId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${OSV_VULN_URL}/${encodeURIComponent(osvId)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function hydrateOsvVulns(
  refs: { osvId: string; pkg: { name: string; version: string } }[],
): Promise<OsvVulnHit[]> {
  const hits: OsvVulnHit[] = [];
  const seen = new Set<string>();
  const detailCache = new Map<string, Record<string, unknown> | null>();

  for (let i = 0; i < refs.length; i += VULN_FETCH_CONCURRENCY) {
    const chunk = refs.slice(i, i + VULN_FETCH_CONCURRENCY);
    await Promise.all(
      chunk.map(async ({ osvId, pkg }) => {
        if (!detailCache.has(osvId)) {
          detailCache.set(osvId, await fetchOsvVulnDetails(osvId));
        }
        const vuln = detailCache.get(osvId);
        if (!vuln) return;

        const cveId = normalizeCveId(String(vuln.id ?? osvId));
        if (!cveId) return;

        const key = `${cveId}\0${pkg.name}`;
        if (seen.has(key)) return;
        seen.add(key);

        const summaryRaw =
          (typeof vuln.summary === "string" && vuln.summary) ||
          (typeof vuln.details === "string" && vuln.details) ||
          undefined;

        hits.push({
          cveId: cveId.slice(0, 32),
          packageName: pkg.name.slice(0, 255),
          packageVersion: pkg.version.slice(0, 255),
          manager: "osv",
          severity: severityFromOsv(
            vuln as {
              severity?: { type?: string; score?: string }[];
              database_specific?: Record<string, unknown>;
            },
          ),
          summary: summaryRaw?.slice(0, 2000),
          fixedVersion: fixedVersionFromOsv(
            vuln as {
              affected?: { ranges?: { events?: { fixed?: string }[] }[] }[];
            },
          )?.slice(0, 255),
          source: "osv",
        });
      }),
    );
  }

  return hits;
}

export async function queryOsvBatch(
  ecosystem: string,
  packages: { name: string; version: string }[],
): Promise<OsvVulnHit[]> {
  const refs: { osvId: string; pkg: { name: string; version: string } }[] = [];
  const seenRef = new Set<string>();

  for (let i = 0; i < packages.length; i += BATCH_SIZE) {
    const chunk = packages.slice(i, i + BATCH_SIZE);
    const body = {
      queries: chunk.map((p) => ({
        package: { name: p.name, ecosystem },
        version: p.version,
      })),
    };

    const res = await fetch(OSV_BATCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) continue;

    const data = (await res.json()) as {
      results?: { vulns?: Record<string, unknown>[] }[];
    };

    for (let j = 0; j < chunk.length; j++) {
      const pkg = chunk[j]!;
      const result = data.results?.[j];
      if (!result?.vulns?.length) continue;

      for (const vuln of result.vulns) {
        const osvId = String(vuln.id ?? "");
        if (!osvId) continue;
        const refKey = `${osvId}\0${pkg.name}`;
        if (seenRef.has(refKey)) continue;
        seenRef.add(refKey);
        refs.push({ osvId, pkg });
      }
    }
  }

  return hydrateOsvVulns(refs);
}

export async function scanPackagesWithOsv(
  osType: string,
  osDetail: string | null | undefined,
  packages: OsvPackageInput[],
): Promise<OsvVulnHit[]> {
  const byEcosystem = new Map<string, OsvPackageInput[]>();
  const effectiveDetail =
    looksLikeOsRelease(osDetail) || !packages.length
      ? osDetail
      : (() => {
          const major = inferDebianMajorFromPackages(packages);
          return major ? `ID=debian\nVERSION_ID=${major}` : osDetail;
        })();

  for (const p of packages) {
    if (!p.name || !p.version) continue;
    const eco = osvEcosystem(osType, effectiveDetail, p.manager);
    if (!eco) continue;
    const list = byEcosystem.get(eco) ?? [];
    if (list.length >= MAX_PACKAGES) continue;
    list.push(p);
    byEcosystem.set(eco, list);
  }

  const all: OsvVulnHit[] = [];
  for (const [ecosystem, pkgs] of byEcosystem) {
    const hits = await queryOsvBatch(
      ecosystem,
      pkgs.map((p) => ({ name: p.name, version: p.version })),
    );
    for (const h of hits) {
      const orig = pkgs.find((p) => p.name === h.packageName);
      if (orig) h.manager = orig.manager;
    }
    all.push(...hits);
  }
  return all;
}
