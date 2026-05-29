"use client";

import { useState } from "react";
import { AgentActivityConsole } from "@/components/AgentActivityConsole";
import {
  groupPackages,
  managerLabel,
  packageCategory,
  packageChangeSummary,
  packageFriendlyName,
  patchWorkflowStep,
  planPackageCount,
  planStatusLabel,
  planStatusTone,
  type PatchPlanLike,
  type PatchPlanPackage,
  type PatchWorkflowStep,
} from "@/lib/patch-ui";

const STEPS: { id: PatchWorkflowStep; label: string }[] = [
  { id: "check", label: "Check" },
  { id: "scanning", label: "Scan" },
  { id: "review", label: "Review" },
  { id: "installing", label: "Install" },
  { id: "done", label: "Done" },
];

function stepIndex(
  step: PatchWorkflowStep,
  plan: PatchPlanLike | null | undefined,
): number {
  switch (step) {
    case "check":
    case "up_to_date":
      return 0;
    case "scanning":
      return 1;
    case "review":
      return 2;
    case "installing":
      return 3;
    case "done":
      return 4;
    case "failed":
      return currentStepForFailed(plan);
    default:
      return 0;
  }
}

function currentStepForFailed(plan: PatchPlanLike | null | undefined): number {
  if (plan?.executeJobId) return 3;
  if (plan?.dryRunJobId) return 1;
  return 0;
}

function PackageGroup({
  title,
  hint,
  packages,
  canSelect,
  selected,
  onToggle,
}: {
  title: string;
  hint?: string;
  packages: PatchPlanPackage[];
  canSelect: boolean;
  selected: Set<string>;
  onToggle: (name: string) => void;
}) {
  if (!packages.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-black/20">
      <div className="border-b border-white/10 px-3 py-2">
        <div className="text-xs font-medium text-white/80">{title}</div>
        {hint ? <div className="text-xs text-white/45">{hint}</div> : null}
      </div>
      <ul className="divide-y divide-white/5">
        {packages.map((pkg) => (
          <li
            key={pkg.name}
            className="flex flex-wrap items-start gap-3 px-3 py-2.5 text-sm"
          >
            {canSelect ? (
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.has(pkg.name)}
                onChange={() => onToggle(pkg.name)}
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="font-medium text-white/90">
                {packageFriendlyName(pkg.name)}
              </div>
              <div className="font-mono text-xs text-white/45">{pkg.name}</div>
              <div className="mt-0.5 text-xs text-white/60">
                {packageChangeSummary(pkg)}
              </div>
            </div>
            {pkg.security ? (
              <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-300">
                Security
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PatchPanel({
  agentHostname,
  packageUpdatesPending,
  kernelUpdatePending,
  cveCount,
  patchPlans,
  activePlan,
  selectedPlanPackages,
  securityOnly,
  setSecurityOnly,
  ackReboot,
  setAckReboot,
  actionBusy,
  onCheckUpdates,
  onKernelMaintenance,
  rebootRequired,
  kernelRunning,
  onInstall,
  onCancel,
  onSelectPlan,
  onTogglePackage,
  onSelectAll,
  onClearSelection,
  jobs,
  consoleJobId,
  onConsoleJobId,
  binaryUpgrading,
  binaryUpgradeError,
  agentVersion,
}: {
  agentHostname: string;
  packageUpdatesPending?: number;
  kernelUpdatePending?: boolean;
  cveCount?: number;
  patchPlans: PatchPlanLike[];
  activePlan: PatchPlanLike | null;
  selectedPlanPackages: Set<string>;
  securityOnly: boolean;
  setSecurityOnly: (v: boolean) => void;
  ackReboot: boolean;
  setAckReboot: (v: boolean) => void;
  actionBusy: string | null;
  onCheckUpdates: () => void;
  onKernelMaintenance?: () => void;
  rebootRequired?: boolean;
  kernelRunning?: string | null;
  onInstall: () => void;
  onCancel: (planId: string) => void;
  onSelectPlan: (plan: PatchPlanLike) => void;
  onTogglePackage: (name: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  jobs: Array<{ id: string; type: string; status: string; createdAt: string }>;
  consoleJobId: string | null;
  onConsoleJobId: (jobId: string | null) => void;
  binaryUpgrading?: boolean;
  binaryUpgradeError?: string | null;
  agentVersion?: string | null;
}) {
  const step = patchWorkflowStep(activePlan, patchPlans);
  const currentStep = stepIndex(step, activePlan);
  const pkgCount = planPackageCount(activePlan?.packages);
  const selectedCount = selectedPlanPackages.size;
  const grouped = groupPackages(activePlan?.packages ?? []);
  const canInstall =
    activePlan?.status === "READY" && pkgCount > 0 && selectedCount > 0;
  const needsRebootAck =
    !!activePlan?.rebootMayBeRequired && activePlan.status === "READY";
  const showKernelRestart =
    !!onKernelMaintenance &&
    (kernelUpdatePending || rebootRequired) &&
    agentHostname.length > 0;
  const [kernelModalOpen, setKernelModalOpen] = useState(false);
  const [kernelAck, setKernelAck] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
          <div className="text-xs uppercase text-white/45">Pending updates</div>
          <div className="mt-1 text-2xl font-semibold">
            {packageUpdatesPending ?? 0}
          </div>
          <div className="text-xs text-white/50">from last inventory scan</div>
        </div>
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
          <div className="text-xs uppercase text-white/45">Kernel</div>
          <div className="mt-1 text-sm font-medium">
            {kernelUpdatePending ? (
              <span className="text-amber-300">Update available</span>
            ) : (
              <span className="text-emerald-400">Up to date</span>
            )}
          </div>
          <div className="text-xs text-white/50">reboot needed after kernel patches</div>
        </div>
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
          <div className="text-xs uppercase text-white/45">Known CVEs</div>
          <div className="mt-1 text-2xl font-semibold">{cveCount ?? 0}</div>
          <div className="text-xs text-white/50">tracked on {agentHostname}</div>
        </div>
      </div>

      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {STEPS.map((s, i) => {
            const active = i === currentStep;
            const done = i < currentStep;
            return (
              <div key={s.id} className="flex items-center gap-2">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                    active
                      ? "bg-[hsl(var(--accent))] text-black"
                      : done
                        ? "bg-emerald-500/25 text-emerald-300"
                        : "bg-white/10 text-white/40"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </div>
                <span
                  className={`text-xs ${active ? "text-white" : "text-white/45"}`}
                >
                  {s.label}
                </span>
                {i < STEPS.length - 1 ? (
                  <span className="mx-1 text-white/20">→</span>
                ) : null}
              </div>
            );
          })}
        </div>

        <AgentActivityConsole
          agentHostname={agentHostname}
          patchPlans={patchPlans}
          activePlan={activePlan}
          jobs={jobs}
          selectedJobId={consoleJobId}
          onSelectJobId={onConsoleJobId}
          binaryUpgrading={binaryUpgrading}
          binaryUpgradeError={binaryUpgradeError}
          agentVersion={agentVersion}
          compact
        />

        {step === "up_to_date" ? (
          <div className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {agentHostname} is up to date — {managerLabel(activePlan?.manager ?? "apt")} reports
            no pending upgrades.
            {cveCount ? (
              <span className="block mt-1 text-emerald-200/80">
                {cveCount} CVEs are still tracked. Run another check if you
                refreshed inventory or expect new security fixes.
              </span>
            ) : null}
          </div>
        ) : null}

        {step === "review" && activePlan ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-medium">
                  {pkgCount} update{pkgCount === 1 ? "" : "s"} ready
                </div>
                <div className="text-sm text-white/55">
                  Review what will be installed on {agentHostname}, then confirm.
                  Only selected packages are patched — Docker and other apps are
                  not removed.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10"
                  onClick={onSelectAll}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10"
                  onClick={onClearSelection}
                >
                  Clear
                </button>
              </div>
            </div>

            {grouped.kernel.length > 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                Kernel updates require a reboot before the new kernel is active.
              </div>
            ) : null}

            {activePlan.planSource === "cve-hints" ? (
              <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
                Some packages were suggested from CVE data. If an exact version
                is not in apt, Fleet installs the latest available version
                instead.
              </div>
            ) : null}

            <PackageGroup
              title="Kernel"
              hint="Usually requires reboot"
              packages={grouped.kernel}
              canSelect
              selected={selectedPlanPackages}
              onToggle={onTogglePackage}
            />
            <PackageGroup
              title="Security updates"
              packages={grouped.security.filter(
                (p) => packageCategory(p.name) !== "kernel",
              )}
              canSelect
              selected={selectedPlanPackages}
              onToggle={onTogglePackage}
            />
            <PackageGroup
              title="Other updates"
              packages={grouped.other}
              canSelect
              selected={selectedPlanPackages}
              onToggle={onTogglePackage}
            />

            {needsRebootAck ? (
              <label className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-100">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={ackReboot}
                  onChange={(e) => setAckReboot(e.target.checked)}
                />
                <span>
                  I understand a reboot may be required after these updates
                  (especially kernel packages).
                </span>
              </label>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                disabled={
                  !!actionBusy ||
                  !canInstall ||
                  (needsRebootAck && !ackReboot)
                }
                className="rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
                onClick={onInstall}
              >
                {actionBusy === "approve"
                  ? "Installing…"
                  : `Install ${selectedCount} update${selectedCount === 1 ? "" : "s"}`}
              </button>
              <button
                type="button"
                disabled={!!actionBusy}
                className="rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                onClick={() => onCancel(activePlan.id)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {step === "installing" ? (
          <p className="text-sm text-amber-100/90">
            Installing on {agentHostname} — see live output in the console above.
          </p>
        ) : null}

        {step === "done" && activePlan ? (
          <div className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            Last patch completed successfully.
            {activePlan.rebootMayBeRequired ? (
              <span className="block mt-1">
                Reboot {agentHostname} when convenient to activate kernel updates.
              </span>
            ) : null}
          </div>
        ) : null}

        {step === "failed" && activePlan ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            <div className="font-medium">
              {activePlan.status === "REJECTED"
                ? "Update check cancelled"
                : "Update workflow failed"}
            </div>
            <p className="mt-1 text-red-100/80">
              {activePlan.status === "REJECTED"
                ? "This preview was cancelled. Run another check when you are ready."
                : "Review the console output above, fix any host issues, then run a new check."}
            </p>
          </div>
        ) : null}

        {step === "check" || step === "up_to_date" || step === "done" || step === "failed" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
            <button
              type="button"
              disabled={!!actionBusy}
              className="rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
              onClick={onCheckUpdates}
            >
              {actionBusy === "preview" ? "Checking…" : "Check for updates"}
            </button>
            <label className="flex items-center gap-2 text-sm text-white/60">
              <input
                type="checkbox"
                checked={securityOnly}
                onChange={(e) => setSecurityOnly(e.target.checked)}
              />
              Security updates only
            </label>
            <span className="text-xs text-white/45">
              Safe: preview first, you approve before anything installs
            </span>
            {showKernelRestart ? (
              <button
                type="button"
                disabled={!!actionBusy}
                className="rounded-md border border-amber-500/50 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/25 disabled:opacity-50"
                onClick={() => {
                  setKernelAck(false);
                  setKernelModalOpen(true);
                }}
              >
                {actionBusy === "kernel"
                  ? "Kernel update & reboot…"
                  : "Install kernel & reboot"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {kernelModalOpen && onKernelMaintenance ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg space-y-4 rounded-xl border border-amber-500/40 bg-[hsl(var(--card))] p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-amber-100">
              Kernel update and host reboot
            </h2>
            <div className="space-y-2 text-sm text-white/80">
              <p>
                This will run on <strong className="text-white">{agentHostname}</strong>{" "}
                immediately — not a preview:
              </p>
              <ul className="list-disc space-y-1 pl-5 text-white/75">
                <li>
                  Install pending <span className="font-mono text-xs">linux-image</span> /{" "}
                  <span className="font-mono text-xs">linux-headers</span> packages via apt
                  (if any are waiting)
                </li>
                <li>Reboot the server so the new kernel becomes active</li>
              </ul>
              <p className="rounded-md border border-red-500/35 bg-red-500/10 px-3 py-2 text-red-100">
                The host will go offline. SSH sessions, containers, and Fleet heartbeats will
                drop until it comes back. Save work and ensure you can tolerate downtime.
              </p>
              {kernelRunning ? (
                <p className="text-xs text-white/55">
                  Running kernel: <span className="font-mono">{kernelRunning}</span>
                </p>
              ) : null}
            </div>
            <label className="flex items-start gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                className="mt-1"
                checked={kernelAck}
                onChange={(e) => setKernelAck(e.target.checked)}
              />
              <span>
                I understand this installs kernel packages (when available) and reboots{" "}
                {agentHostname} without a separate approval step.
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-2 text-sm text-white/70 hover:bg-white/10"
                onClick={() => setKernelModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!kernelAck || !!actionBusy}
                className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
                onClick={() => {
                  setKernelModalOpen(false);
                  onKernelMaintenance();
                }}
              >
                Install kernel &amp; reboot now
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {patchPlans.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          <div className="border-b border-white/10 px-4 py-2 text-xs uppercase text-white/45">
            Recent activity
          </div>
          <table className="w-full border-collapse text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase text-white/45">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Updates</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {patchPlans.slice(0, 8).map((pl) => (
                <tr key={pl.id} className="border-t border-white/5">
                  <td className="px-3 py-2 text-xs text-white/55">
                    {new Date(pl.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <span className={planStatusTone(pl.status)}>
                      {planStatusLabel(pl.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2">{planPackageCount(pl.packages)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="text-xs text-[hsl(var(--accent))] hover:underline"
                      onClick={() => {
                        onSelectPlan(pl);
                        const jid = pl.executeJobId ?? pl.dryRunJobId;
                        if (jid) onConsoleJobId(jid);
                      }}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
