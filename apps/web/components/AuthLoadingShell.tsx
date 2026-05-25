"use client";

import { Shell } from "@/components/Shell";

/** Static shell shown during SSR + first client paint while auth/session is unresolved. */
export function AuthLoadingShell() {
  return (
    <Shell>
      <div className="text-sm text-white/50">Loading…</div>
    </Shell>
  );
}
