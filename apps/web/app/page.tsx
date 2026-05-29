"use client";

import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import { DashboardFleet } from "@/components/DashboardFleet";
import { useSession } from "@/lib/useSession";

export default function HomePage() {
  const { hydrated, checked, authed } = useSession();

  if (!hydrated || !checked) return <AuthLoadingShell />;
  if (!authed) return null;

  return (
    <Shell>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Fleet dashboard</h1>
          <p className="text-sm text-white/60">
            Live posture across enrolled agents, packages, jobs, and CrowdSec coverage.
          </p>
        </div>
        <DashboardFleet />
      </div>
    </Shell>
  );
}
