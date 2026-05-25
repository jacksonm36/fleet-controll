"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { useHydrated } from "@/lib/useHydrated";

export default function EnrollmentPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [ttl, setTtl] = useState(120);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (!getToken()) router.replace("/login");
  }, [hydrated, router]);

  async function mint(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiFetch<{ token: string; expiresAt: string }>(
        "/api/enrollment-tokens",
        {
          method: "POST",
          body: JSON.stringify({ ttlMinutes: ttl }),
        },
      );
      setToken(res.token);
      setExpiresAt(res.expiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  if (!hydrated) return <AuthLoadingShell />;

  if (!getToken()) return null;

  const apiBase =
    (typeof process.env.NEXT_PUBLIC_API_URL === "string" &&
      process.env.NEXT_PUBLIC_API_URL.trim()) ||
    "http://127.0.0.1:4000";
  const githubRaw =
    (typeof process.env.NEXT_PUBLIC_FLEET_GITHUB_RAW_BASE === "string" &&
      process.env.NEXT_PUBLIC_FLEET_GITHUB_RAW_BASE.trim()) ||
    "https://raw.githubusercontent.com/jacksonm36/fleet-controll/main";
  const shellToken = token ? token.replace(/'/g, "'\\''") : "";

  return (
    <Shell>
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Enrollment tokens</h1>
          <p className="text-sm text-white/60">
            Operators mint single-use pairing secrets for agents during bootstrap.
          </p>
        </div>

        <form
          onSubmit={mint}
          className="space-y-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"
        >
          <label className="block text-sm">
            <span className="text-white/70">TTL (minutes)</span>
            <input
              type="number"
              min={5}
              max={10080}
              value={ttl}
              onChange={(e) => setTtl(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-black/30 px-3 py-2 outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]"
            />
          </label>
          {error ? (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
              {error}
            </div>
          ) : null}
          <button
            type="submit"
            className="rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
          >
            Mint token
          </button>
        </form>

        {token ? (
          <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-6">
            <div className="text-xs uppercase tracking-wide text-emerald-200">
              Copy once · expires {expiresAt ? new Date(expiresAt).toLocaleString() : ""}
            </div>
            <code className="block break-all rounded-md bg-black/40 p-3 text-xs">
              {token}
            </code>
            <p className="text-xs text-white/60">
              One-line install on Linux / WSL (discovers controller, builds agent, enrolls):
            </p>
            <pre className="overflow-auto rounded-md bg-black/40 p-3 text-xs text-white/80">
              {`# Best: curl from this controller (auto-sets central URL)\ncurl -fsSL '${apiBase}/api/public/agent-install.sh' \\\n  | FLEET_ENROLL_TOKEN='${shellToken}' bash\n\n# Or from GitHub raw (set FLEET_GITHUB_RAW_BASE / push your fork first)\ncurl -fsSL '${githubRaw}/scripts/install-fleet-agent.sh' \\\n  | FLEET_ENROLL_TOKEN='${shellToken}' bash\n\n# Fast install when a GitHub Release exists\n# FLEET_USE_RELEASE=1 curl -fsSL ... | FLEET_ENROLL_TOKEN='...' bash`}
            </pre>
            <pre className="overflow-auto rounded-md bg-black/40 p-3 text-xs text-white/80">
              {`# Manual run after install\nfleet-agent --central '${apiBase}' --enroll-token '${shellToken}'`}
            </pre>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
