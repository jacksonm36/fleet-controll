"use client";

import { useMemo } from "react";
import { JobLogStream } from "@/components/JobLogStream";
import {
  liveJobIdForPlan,
  patchWorkflowStep,
  planStatusLabel,
  type PatchPlanLike,
  type PatchWorkflowStep,
} from "@/lib/patch-ui";

type JobRow = { id: string; type: string; status: string; createdAt: string };

const STEP_HINT: Record<PatchWorkflowStep, string> = {
  check: "Run a check to scan for available package updates.",
  scanning: "Scanning packages on the host — live apt/dnf output appears below.",
  review: "Review selected packages above, then confirm install.",
  installing: "Installing approved updates — progress streams below.",
  up_to_date: "No pending apt upgrades. Kernel or CVE data may still need attention.",
  done: "Last install finished. Run another check anytime.",
  failed: "Something failed — read the log below, then run a new check.",
};

export function AgentActivityConsole({
  agentHostname,
  patchPlans,
  activePlan,
  jobs,
  selectedJobId,
  onSelectJobId,
  binaryUpgrading,
  binaryUpgradeError,
  agentVersion,
  compact,
}: {
  agentHostname: string;
  patchPlans: PatchPlanLike[];
  activePlan: PatchPlanLike | null;
  jobs: JobRow[];
  selectedJobId: string | null;
  onSelectJobId: (jobId: string | null) => void;
  binaryUpgrading?: boolean;
  binaryUpgradeError?: string | null;
  agentVersion?: string | null;
  compact?: boolean;
}) {
  const step = patchWorkflowStep(activePlan, patchPlans);
  const autoJobId = liveJobIdForPlan(activePlan, patchPlans);
  const streamJobId = selectedJobId ?? autoJobId;

  const jobOptions = useMemo(() => {
    const fromPlans = patchPlans.flatMap((pl) =>
      [pl.dryRunJobId, pl.executeJobId].filter(Boolean) as string[],
    );
    const fromJobs = jobs.map((j) => j.id);
    return [...new Set([...fromPlans, ...fromJobs])].slice(0, 12);
  }, [patchPlans, jobs]);

  return (
    <section className="space-y-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-white/45">
            Activity console
          </div>
          <p className="mt-0.5 text-sm text-white/75">
            {activePlan ? planStatusLabel(activePlan.status) : STEP_HINT[step]}
          </p>
          <p className="text-xs text-white/45">{STEP_HINT[step]}</p>
        </div>
        {jobOptions.length > 1 ? (
          <label className="text-xs text-white/50">
            Log source
            <select
              value={streamJobId ?? ""}
              onChange={(e) =>
                onSelectJobId(e.target.value ? e.target.value : null)
              }
              className="mt-1 block rounded-md border border-white/15 bg-black/40 px-2 py-1 text-xs text-white"
            >
              <option value="">Auto (current task)</option>
              {jobOptions.map((jid) => (
                <option key={jid} value={jid}>
                  {jid.slice(0, 10)}…
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {(binaryUpgrading || binaryUpgradeError) && (
        <div
          className={`rounded-md px-3 py-2 text-xs ${
            binaryUpgradeError
              ? "border border-red-500/30 bg-red-500/10 text-red-200"
              : "border border-amber-500/30 bg-amber-500/10 text-amber-100"
          }`}
        >
          {binaryUpgradeError
            ? `Agent binary upgrade failed: ${binaryUpgradeError}`
            : `Upgrading fleet-agent on ${agentHostname}…`}
          {agentVersion ? (
            <span className="ml-2 font-mono text-white/50">{agentVersion}</span>
          ) : null}
        </div>
      )}

      <JobLogStream
        jobId={streamJobId}
        maxHeight={compact ? "14rem" : "22rem"}
        emptyMessage={
          step === "scanning" || step === "installing"
            ? "Waiting for job output…"
            : `No live task on ${agentHostname}. Run “Check for updates” or open a job from the list.`
        }
      />
    </section>
  );
}
