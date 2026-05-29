"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api";
import { buildAgentInstallCommand } from "@/lib/enrollment-install";

/** Full enroll flow on the dashboard: mint token + encrypted install command. */
export function EnrollmentFrontPanel({ agentCount }: { agentCount: number }) {
  const [ttl, setTtl] = useState(120);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const installCmd = mintedToken ? buildAgentInstallCommand(mintedToken) : "";

  async function mint(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ token: string; expiresAt: string }>(
        "/api/enrollment-tokens",
        {
          method: "POST",
          body: JSON.stringify({ ttlMinutes: ttl }),
        },
      );
      setMintedToken(res.token);
      setExpiresAt(res.expiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mint token");
    } finally {
      setBusy(false);
    }
  }

  const expanded = agentCount === 0 || mintedToken;

  return (
    <section
      className={
        expanded
          ? "rounded-xl border-2 border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 to-transparent p-5"
          : "rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            Enroll an agent
          </p>
          <h2 className="text-lg font-semibold text-white">
            {agentCount === 0
              ? "No agents yet — complete setup in 2 steps"
              : "Add another host"}
          </h2>
          <p className="mt-1 text-sm text-white/60">
            Mint a token, then run the install command on the agent (HTTP :4000 fetch,
            HTTPS enroll + auto certificate).
          </p>
        </div>
        {agentCount > 0 && !mintedToken ? (
          <Link
            href="/agents#enroll"
            className="text-sm text-[hsl(var(--accent))] hover:underline"
          >
            Full enroll &amp; deploy →
          </Link>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <form onSubmit={mint} className="space-y-3 rounded-lg border border-[hsl(var(--border))] bg-black/20 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-black">
              1
            </span>
            Mint enrollment token
          </div>
          <label className="block text-xs text-white/50">
            TTL (minutes)
            <input
              type="number"
              min={5}
              max={10080}
              value={ttl}
              onChange={(e) => setTtl(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-black/30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]"
            />
          </label>
          {error ? (
            <p className="text-sm text-red-300">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Minting…" : "Mint token"}
          </button>
        </form>

        <div className="space-y-3 rounded-lg border border-[hsl(var(--border))] bg-black/20 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-black">
              2
            </span>
            Run on agent host
          </div>
          {mintedToken ? (
            <>
              <p className="text-xs text-emerald-200/80">
                Single-use · expires{" "}
                {expiresAt ? new Date(expiresAt).toLocaleString() : "soon"}
              </p>
              <p className="text-[10px] text-white/45">
                Use port 4000 (not https:// without -k)
              </p>
              <pre className="max-h-44 overflow-auto rounded-md bg-black/40 p-3 text-[11px] leading-relaxed text-white/85">
                {installCmd}
              </pre>
              <button
                type="button"
                className="w-full rounded-md bg-[hsl(var(--accent))] px-3 py-2 text-sm font-semibold text-black hover:opacity-90"
                onClick={() => {
                  void navigator.clipboard.writeText(installCmd).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
              >
                {copied ? "Copied install command" : "Copy install command"}
              </button>
            </>
          ) : (
            <p className="text-sm text-white/50">
              Mint a token first, then paste the command into your agent shell (e.g.{" "}
              <code className="text-[hsl(var(--accent))]">root@test</code>).
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
