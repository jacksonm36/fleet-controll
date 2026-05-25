"use client";

import { useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";
import { getToken } from "@/lib/auth";

export function JobLogs({
  jobId,
  open,
  onClose,
}: {
  jobId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open || !jobId) return;
    setLines([]);
    const token = getToken();
    if (!token) return;

    const ac = new AbortController();

    async function run() {
      const res = await fetch(apiUrl(`/api/jobs/${jobId}/logs`), {
        headers: { Authorization: `Bearer ${token}` },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) return;
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
            const payload = JSON.parse(line) as { message?: string; seq?: number };
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

    void run();
    return () => ac.abort();
  }, [open, jobId]);

  if (!open || !jobId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex h-[70vh] w-full max-w-3xl flex-col rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold">Job logs · {jobId}</div>
          <button
            type="button"
            className="rounded-md bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <pre className="flex-1 overflow-auto p-4 font-mono text-xs text-emerald-100">
          {lines.join("\n")}
        </pre>
      </div>
    </div>
  );
}
