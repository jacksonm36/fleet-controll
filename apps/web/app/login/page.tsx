"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { apiFetch } from "@/lib/api";
import { markCookieSession, setLegacyToken } from "@/lib/auth";

type LoginStep = "password" | "totp" | "recovery";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<LoginStep>("password");
  const [email, setEmail] = useState("admin");
  const [password, setPassword] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function finishLogin(res: {
    token: string;
    user: { id: string; email: string; role: string };
  }) {
    markCookieSession(res.user);
    setLegacyToken(res.token);
    router.push("/");
  }

  async function onPasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{
        token?: string;
        user?: { id: string; email: string; role: string };
        requiresTotp?: boolean;
        pendingToken?: string;
      }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (res.requiresTotp && res.pendingToken) {
        setPendingToken(res.pendingToken);
        setStep("totp");
        return;
      }
      if (res.token && res.user) {
        await finishLogin({ token: res.token, user: res.user });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function onTotpSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pendingToken) return;
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{
        token: string;
        user: { id: string; email: string; role: string };
      }>("/api/auth/login/totp", {
        method: "POST",
        body: JSON.stringify({ pendingToken, code: totpCode }),
      });
      await finishLogin(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  async function onRecoverySubmit(e: FormEvent) {
    e.preventDefault();
    if (!pendingToken) return;
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{
        token: string;
        user: { id: string; email: string; role: string };
      }>("/api/auth/login/recovery", {
        method: "POST",
        body: JSON.stringify({ pendingToken, recoveryCode }),
      });
      await finishLogin(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid recovery code");
    } finally {
      setBusy(false);
    }
  }

  async function onPasskeyLogin() {
    setError(null);
    setBusy(true);
    try {
      const opts = await apiFetch<{
        options: unknown;
        challengeId: string;
      }>("/api/auth/login/webauthn/options", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() || undefined }),
      });
      const authResp = await startAuthentication({ optionsJSON: opts.options as never });
      const res = await apiFetch<{
        token: string;
        user: { id: string; email: string; role: string };
      }>("/api/auth/login/webauthn/verify", {
        method: "POST",
        body: JSON.stringify({
          challengeId: opts.challengeId,
          response: authResp,
          email: email.trim() || undefined,
        }),
      });
      await finishLogin(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey login failed");
    } finally {
      setBusy(false);
    }
  }

  const onHttps =
    typeof window !== "undefined" && window.location.protocol === "https:";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-8">
      {onHttps ? (
        <div className="w-full max-w-md rounded-lg border-2 border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-100/90">
          <strong className="text-amber-200">HTTPS (nginx):</strong> import the
          controller certificate if prompted (self-signed).{" "}
          <Link href="/tls-setup" className="font-medium text-[hsl(var(--accent))] hover:underline">
            Download CA &amp; trust steps →
          </Link>
        </div>
      ) : null}
      <form
        onSubmit={
          step === "password"
            ? onPasswordSubmit
            : step === "totp"
              ? onTotpSubmit
              : onRecoverySubmit
        }
        className="w-full max-w-md space-y-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 shadow-xl"
      >
        <div>
          <h1 className="text-xl font-semibold">
            {step === "password" ? "Sign in" : step === "totp" ? "Two-factor code" : "Recovery code"}
          </h1>
          <p className="text-sm text-white/60">
            Fleet Patch Control · use your account credentials
          </p>
        </div>

        {step === "password" ? (
          <>
            <label className="block text-sm">
              <span className="text-white/70">Email or username</span>
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
            <button
              type="button"
              disabled={busy}
              onClick={() => void onPasskeyLogin()}
              className="w-full rounded-md border border-white/15 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
            >
              {busy ? "Waiting for passkey…" : "Sign in with passkey"}
            </button>
          </>
        ) : null}

        {step === "totp" ? (
          <>
            <p className="text-sm text-white/60">
              Enter the 6-digit code from your authenticator app for <strong>{email}</strong>.
            </p>
            <input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder="123456"
              className="w-full rounded-md border border-[hsl(var(--border))] bg-black/30 px-3 py-2 outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]"
            />
            <button
              type="button"
              className="text-xs text-[hsl(var(--accent))] hover:underline"
              onClick={() => setStep("recovery")}
            >
              Use a recovery code instead
            </button>
          </>
        ) : null}

        {step === "recovery" ? (
          <>
            <p className="text-sm text-white/60">Enter one of your single-use recovery codes.</p>
            <input
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
              placeholder="ABCD123456"
              className="w-full rounded-md border border-[hsl(var(--border))] bg-black/30 px-3 py-2 outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]"
            />
            <button
              type="button"
              className="text-xs text-[hsl(var(--accent))] hover:underline"
              onClick={() => setStep("totp")}
            >
              Back to authenticator code
            </button>
          </>
        ) : null}

        {error ? (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
