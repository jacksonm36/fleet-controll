"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api";
import { setToken } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@localhost");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiFetch<{ token: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(res.token);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 shadow-xl"
      >
        <div>
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-sm text-white/60">
            Fleet Patch Control · use SEED_ADMIN_* from repo root `.env`
          </p>
        </div>
        <label className="block text-sm">
          <span className="text-white/70">Email</span>
          <input
            className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-black/30 px-3 py-2 outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-white/70">Password</span>
          <input
            type="password"
            className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-black/30 px-3 py-2 outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}
        <button
          type="submit"
          className="w-full rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
