import { prisma } from "@fleet/db";
import type { Job, JobStatus, PatchPlanStatus } from "@prisma/client";

export type PatchPlanPackage = {
  name: string;
  currentVersion?: string;
  targetVersion?: string;
  security?: boolean;
};

export function parsePlanPackages(raw: unknown): PatchPlanPackage[] {
  if (!Array.isArray(raw)) return [];
  const out: PatchPlanPackage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : "";
    if (!name) continue;
    out.push({
      name,
      currentVersion:
        typeof o.currentVersion === "string" ? o.currentVersion : undefined,
      targetVersion:
        typeof o.targetVersion === "string" ? o.targetVersion : undefined,
      security: o.security === true,
    });
  }
  return out;
}

const SECURITY_SEVERITIES = new Set(["CRITICAL", "HIGH"]);

/** Compare Debian-style version strings; returns positive if a > b. */
export function comparePackageVersions(a: string, b: string): number {
  const tokenize = (v: string) =>
    v
      .trim()
      .split(/[.:-]/)
      .map((part) => {
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) ? n : part.toLowerCase();
      });
  const pa = tokenize(a);
  const pb = tokenize(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (typeof va === "number" && typeof vb === "number") {
      if (va !== vb) return va - vb;
      continue;
    }
    const sa = String(va);
    const sb = String(vb);
    if (sa !== sb) return sa.localeCompare(sb);
  }
  return 0;
}

export async function buildCveHintPlan(
  agentId: string,
  securityOnly: boolean,
): Promise<PatchPlanPackage[]> {
  const findings = await prisma.cveFinding.findMany({
    where: {
      agentId,
      packageName: { not: null },
      NOT: { packageName: "" },
    },
    select: {
      packageName: true,
      packageVersion: true,
      fixedVersion: true,
      severity: true,
    },
  });

  const records = await prisma.packageRecord.findMany({
    where: { agentId, updateAvailable: true },
    select: { name: true, version: true, availableVersion: true },
  });
  const aptAvailable = new Map(records.map((r) => [r.name, r]));

  const byPkg = new Map<string, PatchPlanPackage>();
  for (const f of findings) {
    const name = f.packageName?.trim();
    if (!name) continue;
    const isSecurity = SECURITY_SEVERITIES.has(f.severity);
    if (securityOnly && !isSecurity) continue;

    const rec = aptAvailable.get(name);
    // Only plan packages apt actually offers an upgrade for; CVE fixedVersion
    // often targets a different suite/release and must not be pinned in apt.
    if (!rec?.availableVersion?.trim()) continue;

    const target = rec.availableVersion.trim();
    const current = rec.version?.trim() || f.packageVersion?.trim() || undefined;
    if (target === current) continue;

    const cur = byPkg.get(name);
    if (!cur) {
      byPkg.set(name, {
        name,
        currentVersion: current,
        targetVersion: target,
        security: isSecurity,
      });
      continue;
    }
    if (isSecurity) cur.security = true;
    if (!cur.currentVersion && current) cur.currentVersion = current;
    if (
      !cur.targetVersion ||
      comparePackageVersions(target, cur.targetVersion) > 0
    ) {
      cur.targetVersion = target;
    }
  }

  return [...byPkg.values()]
    .filter((p) => p.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 200);
}

export async function handlePatchPlanJobComplete(
  job: Job,
  status: JobStatus,
  result: unknown,
  errorMessage?: string | null,
): Promise<void> {
  const plan = await prisma.patchPlan.findFirst({
    where: { dryRunJobId: job.id },
  });
  if (!plan) return;

  // Ignore late dry-run results after reject/approve/supersede.
  if (plan.status !== "PENDING_DRY_RUN") return;

  if (status === "FAILED" || status === "CANCELLED") {
    await prisma.patchPlan.update({
      where: { id: plan.id },
      data: { status: "FAILED" },
    });
    return;
  }

  if (status !== "COMPLETED") return;

  const r = (result ?? {}) as {
    plan?: unknown;
    rebootMayBeRequired?: boolean;
    planSource?: string;
  };
  let packages = parsePlanPackages(r.plan);
  let planSource =
    typeof r.planSource === "string" ? r.planSource.slice(0, 32) : "simulate";

  if (!packages.length) {
    const cveHints = await buildCveHintPlan(plan.agentId, plan.securityOnly);
    if (cveHints.length) {
      packages = cveHints;
      planSource = "cve-hints";
    }
  }

  await prisma.patchPlan.update({
    where: { id: plan.id },
    data: {
      status: packages.length ? "READY" : "NO_UPDATES",
      packages: packages as object[],
      rebootMayBeRequired: r.rebootMayBeRequired === true,
      planSource,
    },
  });
  void errorMessage;
}

function verificationFailed(result: unknown): boolean {
  const r = (result ?? {}) as {
    verification?: { passed?: boolean };
  };
  return r.verification?.passed === false;
}

export async function handlePatchExecuteJobComplete(
  job: Job,
  status: JobStatus,
  result: unknown,
): Promise<void> {
  const plan = await prisma.patchPlan.findFirst({
    where: { executeJobId: job.id },
  });
  const payload = job.payload as Record<string, unknown>;
  const linkedPlanId =
    plan?.id ??
    (typeof payload.patchPlanId === "string" ? payload.patchPlanId : null);
  if (!linkedPlanId && !plan) {
    return;
  }

  const manager =
    typeof payload.manager === "string" ? payload.manager : "apt";
  const packageNames = Array.isArray(payload.packageNames)
    ? (payload.packageNames as string[])
    : [];
  const packageCount =
    packageNames.length > 0
      ? packageNames.length
      : parsePlanPackages(plan?.packages as unknown).length;

  const finishedAt = job.finishedAt ?? new Date();
  const r = (result ?? {}) as {
    packageNames?: string[];
    upgradedCount?: number;
    verification?: { passed?: boolean; issues?: string[] };
    rebootMayBeRequired?: boolean;
  };
  let exitStatus = status === "COMPLETED" ? "COMPLETED" : "FAILED";
  if (verificationFailed(result)) {
    exitStatus = "VERIFICATION_FAILED";
  }

  await prisma.patchRun.create({
    data: {
      agentId: job.agentId,
      patchPlanId: plan?.id ?? linkedPlanId,
      jobId: job.id,
      manager,
      packageCount:
        typeof r.upgradedCount === "number" && r.upgradedCount > 0
          ? r.upgradedCount
          : packageCount,
      exitStatus,
      startedAt: job.startedAt ?? job.createdAt,
      finishedAt,
      summary: (result ?? { packageNames }) as object,
    },
  });

  if (plan) {
    await prisma.patchPlan.update({
      where: { id: plan.id },
      data: {
        status: exitStatus === "COMPLETED" ? "EXECUTED" : "FAILED",
        executedAt: finishedAt,
      },
    });
  }
}

export function patchPlanStatusLabel(status: PatchPlanStatus): string {
  switch (status) {
    case "PENDING_DRY_RUN":
      return "Dry run in progress";
    case "READY":
      return "Ready for approval";
    case "NO_UPDATES":
      return "No apt upgrades";
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
    case "EXECUTED":
      return "Executed";
    case "FAILED":
      return "Failed";
    default:
      return status;
  }
}
