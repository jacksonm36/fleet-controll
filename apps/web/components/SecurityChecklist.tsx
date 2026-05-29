"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type Check = {
  id: string;
  severity: "critical" | "warning" | "info";
  message: string;
};

type SecurityResponse = {
  ok: boolean;
  critical: number;
  warning: number;
  checks: Check[];
};

const tone: Record<Check["severity"], string> = {
  critical: "text-red-300 border-red-500/40 bg-red-500/10",
  warning: "text-amber-200 border-amber-500/40 bg-amber-500/10",
  info: "text-white/70 border-white/15 bg-white/5",
};

export function SecurityChecklist({ admin }: { admin: boolean }) {
  const [data, setData] = useState<SecurityResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    void apiFetch<SecurityResponse>("/api/fleet/security", { cacheTtlMs: 30_000 })
      .then(setData)
      .catch((e) =>
        setErr(e instanceof Error ? e.message : "Could not load security checks"),
      );
  }, [admin]);

  if (!admin) return null;
  if (err) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
        {err}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="text-sm text-white/45">Loading security checklist…</div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className={
            data.ok
              ? "text-emerald-400"
              : "text-amber-300"
          }
        >
          {data.ok
            ? "No critical issues detected"
            : `${data.critical} critical, ${data.warning} warning(s)`}
        </span>
      </div>
      <ul className="space-y-2">
        {data.checks.map((c) => (
          <li
            key={c.id}
            className={`rounded-md border px-3 py-2 text-sm ${tone[c.severity]}`}
          >
            <span className="text-xs uppercase opacity-70">{c.severity}</span>
            <div>{c.message}</div>
          </li>
        ))}
      </ul>
      {data.checks.length === 0 ? (
        <p className="text-sm text-white/45">All configured checks passed.</p>
      ) : null}
    </div>
  );
}
