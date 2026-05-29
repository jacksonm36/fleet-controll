"use client";

import type { FleetSummaryV1 } from "@fleet/types";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useState } from "react";
import { EnrollmentFrontPanel } from "@/components/EnrollmentFrontPanel";
import { TlsSnakeOilBanner } from "@/components/TlsSnakeOilBanner";
import { usePolling } from "@/lib/usePolling";
import { apiFetch } from "@/lib/api";

const FleetChart = dynamic(
  () => import("./FleetChart").then((m) => m.FleetChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 animate-pulse rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]" />
    ),
  },
);

export function DashboardFleet() {
  const [summary, setSummary] = useState<FleetSummaryV1 | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      const data = await apiFetch<FleetSummaryV1>("/api/fleet/summary", {
        cacheTtlMs: 6_000,
      });
      setSummary(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load fleet");
    }
  }, []);

  usePolling(() => loadSummary(), 10_000);

  if (error) {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm">
        {error}
      </div>
    );
  }

  if (!summary) {
    return <div className="text-sm text-white/60">Loading fleet metrics…</div>;
  }

  const cards = [
    { label: "Agents", value: summary.agentCount },
    { label: "Online", value: summary.onlineCount },
    { label: "Outdated apps", value: summary.outdatedPackagesCount },
    { label: "Kernel updates", value: summary.kernelUpdatePendingCount },
    { label: "CVE findings", value: summary.cveCount },
    { label: "Critical CVEs", value: summary.cveCriticalCount },
    { label: "Tracked packages", value: summary.packagesTracked },
    { label: "Pending jobs", value: summary.pendingJobs },
    { label: "Reboot pending", value: summary.rebootRequiredCount },
    { label: "CrowdSec hosts", value: summary.crowdsecHosts },
  ];

  return (
    <div className="space-y-6">
      <TlsSnakeOilBanner />
      <EnrollmentFrontPanel agentCount={summary.agentCount} />

      <Link
        href="/automation"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-[hsl(var(--accent))]/50 bg-gradient-to-r from-[hsl(var(--accent))]/15 to-transparent p-4 transition hover:border-[hsl(var(--accent))]"
      >
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--accent))]">
            Automation
          </div>
          <div className="text-base font-medium text-white">
            Run shell, Ansible, and Terraform on your agents
          </div>
          <div className="mt-1 text-sm text-white/55">
            Quick-start presets, script library, live job logs
          </div>
        </div>
        <span className="rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black">
          Open Automation →
        </span>
      </Link>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
          >
            <div className="text-xs uppercase tracking-wide text-white/50">
              {c.label}
            </div>
            <div className="mt-2 text-2xl font-semibold">{c.value}</div>
          </div>
        ))}
      </div>

      <FleetChart summary={summary} />
    </div>
  );
}
