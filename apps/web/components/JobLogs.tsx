"use client";

import { JobLogStream } from "@/components/JobLogStream";

export function JobLogs({
  jobId,
  open,
  onClose,
}: {
  jobId: string | null;
  open: boolean;
  onClose: () => void;
}) {
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
        <div className="min-h-0 flex-1 overflow-hidden p-4">
          <JobLogStream
            jobId={jobId}
            maxHeight="none"
            className="h-full min-h-[50vh] border border-white/10"
          />
        </div>
      </div>
    </div>
  );
}
