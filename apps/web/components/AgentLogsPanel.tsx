"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type LogLine = { ts: string; line: string; labels: Record<string, string> };

type LogsResponse = {
  lines: LogLine[];
  query: string;
  alternateQueries: string[];
  lokiConfigured: boolean;
  grafanaExploreUrl: string | null;
  hint: string | null;
  journalOnThisLoki?: boolean;
  lokiHostnames?: string[];
  source?: string;
};

export function AgentLogsPanel({
  agentId,
  hostname,
  range,
}: {
  agentId: string;
  hostname: string;
  range: "1h" | "6h" | "24h";
}) {
  const [source, setSource] = useState<
    "jobs" | "host" | "fleet-agent" | "controller"
  >("jobs");
  const [data, setData] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<LogsResponse>(
        `/api/observability/agents/${encodeURIComponent(agentId)}/logs?range=${range}&source=${source}`,
        { cacheTtlMs: 5_000 },
      );
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [agentId, range, source]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 rounded-md border border-white/15 p-0.5 text-xs">
          {(
            [
              ["jobs", "Job logs"],
              ["host", "Host journal"],
              ["fleet-agent", "fleet-agent unit"],
              ["controller", "Controller API/Web"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSource(id)}
              className={`rounded px-2.5 py-1.5 ${
                source === id
                  ? "bg-white/15 font-medium text-white"
                  : "text-white/50 hover:text-white/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
          >
            Refresh logs
          </button>
          {data?.grafanaExploreUrl ? (
            <a
              href={data.grafanaExploreUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-[hsl(var(--accent))] hover:bg-white/10"
            >
              Explore in Grafana ↗
            </a>
          ) : null}
        </div>
      </div>

      {data?.journalOnThisLoki === false &&
      (source === "host" || source === "fleet-agent") ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          <p className="font-medium text-amber-200">Remote agent — no host journal in Loki</p>
          <p className="mt-1 text-xs text-white/70">
            This controller only ships journal logs for{" "}
            <strong>{data.lokiHostnames?.join(", ") ?? "itself"}</strong>. Agent{" "}
            <strong>{hostname}</strong> runs elsewhere. Use{" "}
            <button
              type="button"
              className="text-[hsl(var(--accent))] underline"
              onClick={() => setSource("jobs")}
            >
              Job logs
            </button>{" "}
            for patch/ansible output, or{" "}
            <button
              type="button"
              className="text-[hsl(var(--accent))] underline"
              onClick={() => setSource("controller")}
            >
              Controller API/Web
            </button>{" "}
            for fleet-api/fleet-web on this server.
          </p>
        </div>
      ) : data?.hint ? (
        <p className="text-xs text-white/45">{data.hint}</p>
      ) : null}

      {data?.query ? (
        <div className="rounded-md bg-black/30 px-3 py-2 font-mono text-[11px] text-white/50">
          LogQL: {data.query}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-black/40">
        <div className="border-b border-white/10 px-3 py-2 text-xs text-white/50">
          {loading
            ? "Loading logs…"
            : `${data?.lines.length ?? 0} lines · ${hostname} · last ${range}`}
        </div>
        <pre className="max-h-[28rem] overflow-auto p-3 font-mono text-[11px] leading-relaxed text-emerald-100/90">
          {!loading && (data?.lines.length ?? 0) === 0 ? (
            <span className="text-white/40">
              No lines for this source. Try <strong className="text-white/60">Job logs</strong>{" "}
              for automation output, or run jobs from the Activity tab.
            </span>
          ) : (
            data?.lines.map((l, i) => (
              <div key={`${l.ts}-${i}`} className="whitespace-pre-wrap break-all">
                <span className="text-white/35">
                  {new Date(l.ts).toLocaleTimeString()}{" "}
                </span>
                {l.line}
              </div>
            ))
          )}
        </pre>
      </div>
    </div>
  );
}
