"use client";

import type { FleetSummaryV1 } from "@fleet/types";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function FleetChart({ summary }: { summary: FleetSummaryV1 }) {
  const chartData = [
    { name: "Agents", value: summary.agentCount },
    { name: "Online", value: summary.onlineCount },
    { name: "Outdated apps", value: summary.outdatedPackagesCount },
    { name: "Kernel updates", value: summary.kernelUpdatePendingCount },
    { name: "CVEs", value: summary.cveCount },
    { name: "Critical CVEs", value: summary.cveCriticalCount },
    { name: "Pending jobs", value: summary.pendingJobs },
    { name: "CrowdSec hosts", value: summary.crowdsecHosts },
  ];

  return (
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
  );
}
