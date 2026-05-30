import { prisma } from "@fleet/db";
import type { Job, JobStatus, JobType } from "@prisma/client";
import { isAgentOnline } from "./agent-presence.js";
import {
  handlePatchExecuteJobComplete,
  handlePatchPlanJobComplete,
} from "./patch-plans.js";

/** Max time a job may stay RUNNING before requeue/fail (default 20 min). */
export const JOB_RUNNING_STALE_MS = Number(
  process.env.JOB_RUNNING_STALE_MS ?? 1_200_000,
);

/** RUNNING with no log lines for this long is treated as abandoned (default 3 min). */
export const JOB_RUNNING_NO_LOG_STALE_MS = Number(
  process.env.JOB_RUNNING_NO_LOG_STALE_MS ?? 180_000,
);

/** Requeue RUNNING jobs when the agent has been offline this long (default 90 s). */
export const JOB_OFFLINE_REQUEUE_MS = Number(
  process.env.JOB_OFFLINE_REQUEUE_MS ?? 90_000,
);

/** RUNNING with zero log lines — requeue so /commands can deliver the job again (default 90 s). */
export const JOB_ZOMBIE_NO_LOG_MS = Number(
  process.env.JOB_ZOMBIE_NO_LOG_MS ?? 90_000,
);

const JOB_MAX_REQUEUES = Number(process.env.JOB_MAX_REQUEUES ?? 2);

function runningStaleMs(type: JobType): number {
  switch (type) {
    case "PACKAGE_UPGRADE":
      return Number(process.env.JOB_UPGRADE_STALE_MS ?? 2_700_000);
    case "PACKAGE_PATCH_PLAN":
      return Number(process.env.JOB_PATCH_PLAN_STALE_MS ?? 1_800_000);
    case "HOST_KERNEL_MAINTENANCE":
      return Number(process.env.JOB_KERNEL_STALE_MS ?? 1_800_000);
    default:
      return JOB_RUNNING_STALE_MS;
  }
}

function noLogStaleMs(type: JobType): number {
  switch (type) {
    case "PACKAGE_PATCH_PLAN":
      return Number(process.env.JOB_PATCH_PLAN_NO_LOG_MS ?? 180_000);
    case "PACKAGE_UPGRADE":
      return Number(process.env.JOB_UPGRADE_NO_LOG_MS ?? 900_000);
    default:
      return JOB_RUNNING_NO_LOG_STALE_MS;
  }
}

type RequeueMeta = { requeueCount?: number };

function requeueCount(job: Job): number {
  const r = job.result as RequeueMeta | null;
  return typeof r?.requeueCount === "number" ? r.requeueCount : 0;
}

async function lastLogAt(jobId: string): Promise<Date | null> {
  const row = await prisma.jobLogChunk.findFirst({
    where: { jobId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

async function failJob(job: Job, message: string): Promise<void> {
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: "FAILED" as JobStatus,
      finishedAt: new Date(),
      errorMessage: message.slice(0, 2000),
    },
  });
  if (job.type === "PACKAGE_PATCH_PLAN") {
    await handlePatchPlanJobComplete(job, "FAILED", null, message);
  } else if (job.type === "PACKAGE_UPGRADE") {
    await handlePatchExecuteJobComplete(job, "FAILED", null);
  }
}

async function requeueJob(job: Job, reason: string): Promise<void> {
  const count = requeueCount(job) + 1;
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: "QUEUED",
      startedAt: null,
      finishedAt: null,
      errorMessage: reason.slice(0, 2000),
      result: { requeueCount: count } as object,
    },
  });
}

async function reconcileOneJob(
  job: Job,
  agent: { lastSeenAt: Date | null; status: string },
  now: number,
): Promise<"requeued" | "failed" | "kept"> {
  if (job.status !== "RUNNING" && job.status !== "QUEUED") {
    return "kept";
  }

  const online = isAgentOnline(agent.lastSeenAt, agent.status, now);

  if (job.status === "QUEUED") {
    const age = now - job.createdAt.getTime();
    const queuedStale = Number(process.env.JOB_QUEUED_STALE_MS ?? 3_600_000);
    if (!online && age > JOB_OFFLINE_REQUEUE_MS) {
      // Leave queued — will run when agent returns.
      return "kept";
    }
    if (age > queuedStale) {
      await failJob(job, "Job expired in queue (not started in time)");
      return "failed";
    }
    return "kept";
  }

  const started = job.startedAt?.getTime() ?? job.createdAt.getTime();
  const runningFor = now - started;
  const logAt = await lastLogAt(job.id);
  const sinceLog = logAt ? now - logAt.getTime() : runningFor;

  if (
    !online &&
    agent.lastSeenAt &&
    now - agent.lastSeenAt.getTime() > JOB_OFFLINE_REQUEUE_MS
  ) {
    const reason = "Agent offline — job requeued";
    if (requeueCount(job) >= JOB_MAX_REQUEUES) {
      await failJob(job, reason);
      return "failed";
    }
    await requeueJob(job, reason);
    return "requeued";
  }

  const maxRun = runningStaleMs(job.type);
  const maxSilent = noLogStaleMs(job.type);

  const timedOut = runningFor > maxRun;
  const silent = sinceLog > maxSilent;

  if (!timedOut && !silent) {
    return "kept";
  }

  const reason = timedOut
    ? `Job timed out after ${Math.round(runningFor / 1000)}s`
    : `No progress for ${Math.round(sinceLog / 1000)}s — requeued`;

  if (requeueCount(job) >= JOB_MAX_REQUEUES) {
    await failJob(job, reason);
    return "failed";
  }

  await requeueJob(job, reason);
  return "requeued";
}

/**
 * If a RUNNING job never produced logs (agent crashed or lost work), requeue it so
 * the next /commands poll can run it again.
 */
export async function requeueZombieRunningJob(
  agentId: string,
): Promise<boolean> {
  const job = await prisma.job.findFirst({
    where: { agentId, status: "RUNNING" },
    orderBy: { startedAt: "asc" },
  });
  if (!job) return false;

  const logCount = await prisma.jobLogChunk.count({ where: { jobId: job.id } });
  if (logCount > 0) return false;

  const started = job.startedAt?.getTime() ?? job.createdAt.getTime();
  if (Date.now() - started < JOB_ZOMBIE_NO_LOG_MS) return false;

  if (requeueCount(job) >= JOB_MAX_REQUEUES) {
    await failJob(
      job,
      "Job produced no output — failed after max requeues",
    );
    return true;
  }
  await requeueJob(job, "No log output — requeued for agent retry");
  return true;
}

/** Requeue or fail stuck jobs for one agent. Returns counts. */
export async function reconcileStaleJobsForAgent(
  agentId: string,
): Promise<{ requeued: number; failed: number }> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, lastSeenAt: true, status: true },
  });
  if (!agent) return { requeued: 0, failed: 0 };

  const now = Date.now();
  const active = await prisma.job.findMany({
    where: { agentId, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "asc" },
  });

  let requeued = 0;
  let failed = 0;

  // Only one RUNNING job should exist; requeue extras.
  const running = active.filter((j) => j.status === "RUNNING");
  if (running.length > 1) {
    for (const extra of running.slice(1)) {
      await requeueJob(extra, "Duplicate running job — requeued");
      requeued++;
    }
  }

  for (const job of active) {
    const outcome = await reconcileOneJob(job, agent, now);
    if (outcome === "requeued") requeued++;
    if (outcome === "failed") failed++;
  }

  return { requeued, failed };
}

export async function reconcileAllStaleJobs(): Promise<number> {
  const agents = await prisma.job.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    distinct: ["agentId"],
    select: { agentId: true },
  });
  let total = 0;
  for (const { agentId } of agents) {
    const { requeued, failed } = await reconcileStaleJobsForAgent(agentId);
    total += requeued + failed;
  }
  return total;
}
