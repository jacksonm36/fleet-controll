"use client";

import { FormEvent, useEffect, useState } from "react";
import { EnrollmentInstallCommands } from "@/components/EnrollmentInstallCommands";
import { EnrollmentTlsNote } from "@/components/EnrollmentTlsNote";
import { apiFetch } from "@/lib/api";

export function AgentEnrollmentSection({
  agentCount,
  defaultOpen,
}: {
  agentCount: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? agentCount === 0);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [ttl, setTtl] = useState(120);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#enroll") {
      setOpen(true);
      window.requestAnimationFrame(() => {
        document.getElementById("enroll")?.scrollIntoView({ behavior: "smooth" });
      });
    }
  }, []);

  useEffect(() => {
    if (mintedToken) setOpen(true);
  }, [mintedToken]);

  async function mint(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
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

  return (
    <section
      id="enroll"
      className="scroll-mt-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.03]"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div>
          <div className="text-xs uppercase tracking-wide text-emerald-400/90">
            Enroll new agent
          </div>
          <p className="mt-0.5 text-sm text-white/70">
            Mint a pairing token and run the install script on a Linux host or WSL.
          </p>
        </div>
        <span className="shrink-0 text-xs text-white/45">{open ? "Hide" : "Show"}</span>
      </button>

      {open ? (
        <div className="space-y-4 border-t border-white/10 px-4 pb-4 pt-3">
          <EnrollmentTlsNote />

          <form
            onSubmit={(e) => void mint(e)}
            className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-4 lg:max-w-sm"
          >
            <div className="text-sm font-medium text-white">Step 1 — Mint token</div>
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
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Minting…" : "Mint enrollment token"}
            </button>
          </form>

          {mintedToken ? (
            <div className="space-y-2">
              <div className="text-sm font-medium text-white">Step 2 — Install on agent host</div>
              <EnrollmentInstallCommands token={mintedToken} expiresAt={expiresAt} />
            </div>
          ) : (
            <p className="text-sm text-white/50">
              After minting, copy the install command and run it on the target machine.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
