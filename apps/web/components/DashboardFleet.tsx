"use client";

import type { FleetSummaryV1 } from "@fleet/types";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "@/lib/api";

export function DashboardFleet() {
  const [summary, setSummary] = useState<FleetSummaryV1 | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<FleetSummaryV1>("/api/fleet/summary");
        if (!cancelled) setSummary(data);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load fleet");
      }
    })();
    const id = setInterval(async () => {
      try {
        const data = await apiFetch<FleetSummaryV1>("/api/fleet/summary");
        if (!cancelled) setSummary(data);
      } catch {
        /* ignore */
      }
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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

  const chartData = [
    { name: "Agents", value: summary.agentCount },
    { name: "Online", value: summary.onlineCount },
    { name: "Stale", value: summary.staleCount },
    { name: "Pending jobs", value: summary.pendingJobs },
    { name: "CrowdSec hosts", value: summary.crowdsecHosts },
  ];

  const cards = [
    { label: "Agents", value: summary.agentCount },
    { label: "Online", value: summary.onlineCount },
    { label: "Tracked packages", value: summary.packagesTracked },
    { label: "Pending jobs", value: summary.pendingJobs },
    { label: "Reboot pending", value: summary.rebootRequiredCount },
    { label: "CrowdSec hosts", value: summary.crowdsecHosts },
  ];

  return (
    <div className="space-y-6">
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

      <div className="h-72 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
        <div className="mb-3 text-sm font-medium text-white/80">
          Fleet posture snapshot
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="name" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                borderColor: "#334155",
                color: "#e2e8f0",
              }}
            />
            <Bar dataKey="value" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
