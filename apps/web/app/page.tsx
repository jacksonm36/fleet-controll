"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import { DashboardFleet } from "@/components/DashboardFleet";
import { getToken } from "@/lib/auth";
import { useHydrated } from "@/lib/useHydrated";

export default function HomePage() {
  const router = useRouter();
  const hydrated = useHydrated();

  useEffect(() => {
    if (!hydrated) return;
    if (!getToken()) router.replace("/login");
  }, [hydrated, router]);

  if (!hydrated) return <AuthLoadingShell />;

  if (!getToken()) return null;

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
