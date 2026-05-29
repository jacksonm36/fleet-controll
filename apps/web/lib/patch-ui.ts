export type PatchPlanPackage = {
  name: string;
  currentVersion?: string;
  targetVersion?: string;
  security?: boolean;
};

export type PatchPlanLike = {
  id: string;
  status: string;
  manager: string;
  securityOnly?: boolean;
  packages?: PatchPlanPackage[];
  rebootMayBeRequired?: boolean;
  planSource?: string | null;
  createdAt: string;
  dryRunJobId?: string | null;
  executeJobId?: string | null;
};

export type PatchWorkflowStep =
  | "check"
  | "scanning"
  | "review"
  | "installing"
  | "up_to_date"
  | "done"
  | "failed";

export function managerLabel(manager: string): string {
  switch (manager) {
    case "apt":
    case "dpkg":
      return "apt";
    case "dnf":
    case "yum":
      return "dnf";
    default:
      return manager;
  }
}

export function pickActivePatchPlan<T extends PatchPlanLike>(plans: T[]): T | null {
  if (!plans.length) return null;
  return (
    plans.find(
      (pl) => pl.status === "READY" && planPackageCount(pl.packages) > 0,
    ) ??
    plans.find((pl) => pl.status === "APPROVED") ??
    plans.find((pl) => pl.status === "PENDING_DRY_RUN") ??
    plans.find((pl) => pl.status === "FAILED") ??
    plans.find((pl) => pl.status === "REJECTED") ??
    plans.find((pl) => pl.status === "NO_UPDATES") ??
    plans.find((pl) => pl.status === "EXECUTED") ??
    plans[0]
  );
}

export function planPackageCount(packages: PatchPlanPackage[] | undefined): number {
  return (packages ?? []).filter((p) => p?.name).length;
}

export function planStatusLabel(status: string): string {
  switch (status) {
    case "PENDING_DRY_RUN":
      return "Checking for updates…";
    case "READY":
      return "Updates ready to install";
    case "NO_UPDATES":
      return "System is up to date";
    case "APPROVED":
      return "Installing updates…";
    case "EXECUTED":
      return "Installed successfully";
    case "REJECTED":
      return "Cancelled";
    case "FAILED":
      return "Update failed";
    default:
      return status.replaceAll("_", " ").toLowerCase();
  }
}

export function planStatusTone(status: string): string {
  switch (status) {
    case "EXECUTED":
    case "READY":
      return "text-emerald-400";
    case "NO_UPDATES":
      return "text-white/50";
    case "FAILED":
    case "REJECTED":
      return "text-red-400";
    case "APPROVED":
    case "PENDING_DRY_RUN":
      return "text-amber-300";
    default:
      return "text-white/70";
  }
}

/** Prefer the job that is actively running for patch check or install. */
export function liveJobIdForPlan(
  plan: PatchPlanLike | null,
  plans: PatchPlanLike[],
): string | null {
  const scanning = plans.find((p) => p.status === "PENDING_DRY_RUN");
  if (scanning?.dryRunJobId) return scanning.dryRunJobId;
  if (plan?.status === "APPROVED" && plan.executeJobId) return plan.executeJobId;
  if (plan?.status === "PENDING_DRY_RUN" && plan.dryRunJobId) {
    return plan.dryRunJobId;
  }
  if (plan?.executeJobId) return plan.executeJobId;
  if (plan?.dryRunJobId) return plan.dryRunJobId;
  return null;
}

export function patchWorkflowStep(
  plan: PatchPlanLike | null,
  plans: PatchPlanLike[],
): PatchWorkflowStep {
  const scanning = plans.some((p) => p.status === "PENDING_DRY_RUN");
  if (scanning) return "scanning";
  if (!plan) return "check";
  switch (plan.status) {
    case "PENDING_DRY_RUN":
      return "scanning";
    case "READY":
      return planPackageCount(plan.packages) > 0 ? "review" : "check";
    case "APPROVED":
      return "installing";
    case "EXECUTED":
      return "done";
    case "NO_UPDATES":
      return "up_to_date";
    case "FAILED":
    case "REJECTED":
      return "failed";
    default:
      return "check";
  }
}

export function packageCategory(name: string): "kernel" | "other" {
  const n = name.toLowerCase();
  if (n.startsWith("linux-image") || n.startsWith("linux-headers")) {
    return "kernel";
  }
  return "other";
}

export function packageFriendlyName(name: string): string {
  if (name === "linux-image-amd64") return "Linux kernel (default)";
  if (name.startsWith("linux-image-")) return "Linux kernel";
  if (name.startsWith("linux-headers-")) return "Kernel headers";
  return name;
}

export function packageChangeSummary(pkg: PatchPlanPackage): string {
  const cur = pkg.currentVersion?.trim();
  const tgt = pkg.targetVersion?.trim();
  if (cur && tgt) return `${cur} → ${tgt}`;
  if (tgt) return `install ${tgt}`;
  if (cur) return `update from ${cur}`;
  return "update available";
}

export function groupPackages(packages: PatchPlanPackage[]) {
  const kernel: PatchPlanPackage[] = [];
  const security: PatchPlanPackage[] = [];
  const other: PatchPlanPackage[] = [];
  for (const pkg of packages) {
    if (packageCategory(pkg.name) === "kernel") {
      kernel.push(pkg);
    } else if (pkg.security) {
      security.push(pkg);
    } else {
      other.push(pkg);
    }
  }
  return { kernel, security, other };
}
