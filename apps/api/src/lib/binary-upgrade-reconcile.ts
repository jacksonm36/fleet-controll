import { prisma } from "@fleet/db";

/** How long an agent may be offline while NOT in an active binary upgrade. */
export const BINARY_UPGRADE_STALE_MS = Number(
  process.env.BINARY_UPGRADE_STALE_MS ?? 180_000,
);

/**
 * During binary upgrade the agent stops heartbeating (systemd stop). Allow a long
 * grace window before marking the rollout failed.
 */
export const BINARY_UPGRADE_IN_PROGRESS_STALE_MS = Number(
  process.env.BINARY_UPGRADE_IN_PROGRESS_STALE_MS ?? 600_000,
);

function upgradeStaleMs(inProgress: boolean): number {
  return inProgress ? BINARY_UPGRADE_IN_PROGRESS_STALE_MS : BINARY_UPGRADE_STALE_MS;
}

export function isBinaryUpgradeStale(input: {
  binaryUpgradeInProgress: boolean;
  binaryUpgradeStartedAt: Date | null;
  lastSeenAt: Date | null;
}): boolean {
  const now = Date.now();
  if (input.binaryUpgradeInProgress) {
    const since = input.binaryUpgradeStartedAt ?? input.lastSeenAt;
    if (!since) return false;
    return now - since.getTime() > BINARY_UPGRADE_IN_PROGRESS_STALE_MS;
  }
  if (!input.lastSeenAt) return false;
  return now - input.lastSeenAt.getTime() > BINARY_UPGRADE_STALE_MS;
}

export async function reconcileBinaryUpgradeFlags(input: {
  agentId: string;
  agentBuild?: string | null;
  agentVersion?: string | null;
  agentArch?: string | null;
  heartbeat?: boolean;
}): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: input.agentId },
    select: {
      binaryUpgradeInProgress: true,
      binaryUpgradeLastError: true,
      binaryUpgradeStartedAt: true,
      lastSeenAt: true,
    },
  });
  if (!agent?.binaryUpgradeInProgress) return;

  if (!isBinaryUpgradeStale(agent)) return;

  await prisma.agent.update({
    where: { id: input.agentId },
    data: {
      binaryUpgradeInProgress: false,
      binaryUpgradeStartedAt: null,
      binaryUpgradeForcedBuildId: null,
      binaryUpgradeLastError:
        agent.binaryUpgradeLastError ??
        "Binary upgrade timed out (agent stopped responding during update)",
    },
  });
}

export async function reconcileAllStaleBinaryUpgrades(): Promise<number> {
  const inProgress = await prisma.agent.findMany({
    where: { binaryUpgradeInProgress: true },
    select: {
      id: true,
      binaryUpgradeInProgress: true,
      binaryUpgradeLastError: true,
      binaryUpgradeStartedAt: true,
      lastSeenAt: true,
    },
  });

  const stale = inProgress.filter((a) => isBinaryUpgradeStale(a));
  if (!stale.length) return 0;

  await prisma.$transaction(
    stale.map((a) =>
      prisma.agent.update({
        where: { id: a.id },
        data: {
          binaryUpgradeInProgress: false,
          binaryUpgradeStartedAt: null,
          binaryUpgradeForcedBuildId: null,
          binaryUpgradeLastError:
            a.binaryUpgradeLastError ??
            "Binary upgrade timed out (agent stopped responding during update)",
        },
      }),
    ),
  );
  return stale.length;
}

/** True while an agent is mid-rollout and has not timed out. */
export function agentBinaryUpgradeBusy(input: {
  binaryUpgradeInProgress: boolean;
  binaryUpgradeStartedAt: Date | null;
  lastSeenAt: Date | null;
}): boolean {
  return input.binaryUpgradeInProgress && !isBinaryUpgradeStale(input);
}

export function agentMatchesReleaseBuild(
  agentVersion: string | null | undefined,
  agentBuild: string | null | undefined,
  buildId: string,
): boolean {
  const target = buildId.toLowerCase().trim();
  if (!target) return false;
  const build = (agentBuild ?? "").trim().toLowerCase();
  if (build && build === target) return true;
  const ver = (agentVersion ?? "").trim().toLowerCase();
  return ver.includes(target);
}
