"use client";

import { useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";
import { getToken } from "@/lib/auth";

export function JobLogStream({
  jobId,
  emptyMessage = "Select a job or run a check to see live output here.",
  className = "",
  maxHeight = "16rem",
}: {
  jobId: string | null;
  emptyMessage?: string;
  className?: string;
  maxHeight?: string;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const alive = useRef(true);
  const seenSeq = useRef(new Set<number>());
  const preRef = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!jobId) {
      setLines([]);
      setConnected(false);
      return;
    }
    setLines([]);
    seenSeq.current.clear();
    setConnected(false);
    const ac = new AbortController();
    const token = getToken();
    const headers: HeadersInit = token
      ? { Authorization: `Bearer ${token}` }
      : {};

    async function run() {
      const res = await fetch(apiUrl(`/api/jobs/${jobId}/logs`), {
        headers,
        credentials: "include",
        signal: ac.signal,
      });
      if (!res.ok || !res.body) return;
      setConnected(true);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (alive.current) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("");
          if (!line) continue;
          try {
            const payload = JSON.parse(line) as {
              message?: string;
              seq?: number;
            };
            if (payload.seq !== undefined) {
              if (seenSeq.current.has(payload.seq)) continue;
              seenSeq.current.add(payload.seq);
            }
            const text =
              payload.seq !== undefined
                ? `[${payload.seq}] ${payload.message ?? ""}`
                : (payload.message ?? line);
            setLines((prev) => [...prev, text]);
          } catch {
            setLines((prev) => [...prev, line]);
          }
        }
      }
    }

    void run().catch(() => setConnected(false));
    return () => ac.abort();
  }, [jobId]);

  useEffect(() => {
    if (!stick.current || !preRef.current) return;
    preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [lines.length]);

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-white/10 bg-black/50 ${className}`}>
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-[10px] text-white/45">
        <span>
          {jobId ? (
            <>
              Live output · <span className="font-mono text-white/60">{jobId.slice(0, 12)}…</span>
              {connected ? (
                <span className="ml-2 text-emerald-400">streaming</span>
              ) : (
                <span className="ml-2 text-amber-300">connecting…</span>
              )}
            </>
          ) : (
            "Activity console"
          )}
        </span>
      </div>
      <pre
        ref={preRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        }}
        className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-emerald-100/90"
        style={maxHeight === "none" ? undefined : { maxHeight }}
      >
        {lines.length ? lines.join("\n") : emptyMessage}
      </pre>
    </div>
  );
}
