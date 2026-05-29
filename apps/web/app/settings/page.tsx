"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import { apiFetch } from "@/lib/api";
import { logoutSession, markCookieSession } from "@/lib/auth";
import { SecurityChecklist } from "@/components/SecurityChecklist";
import { passwordPolicyHint, validateNewPassword } from "@/lib/password-policy";
import { useSession } from "@/lib/useSession";
import { useRouter } from "next/navigation";

type MeUser = {
  id: string;
  username: string;
  email: string;
  role: string;
  totpEnabled: boolean;
  passkeyCount: number;
};

type Passkey = {
  id: string;
  nickname: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

export default function SettingsPage() {
  const router = useRouter();
  const { hydrated, checked, authed } = useSession();
  const [user, setUser] = useState<MeUser | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [totpSetup, setTotpSetup] = useState<{
    secret: string;
    otpauthUrl: string;
    qrDataUrl: string;
  } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [profileEmail, setProfileEmail] = useState("");

  async function reload() {
    const me = await apiFetch<{ user: MeUser }>("/api/auth/me");
    setUser(me.user);
    setProfileUsername(me.user.username);
    setProfileEmail(me.user.email);
    markCookieSession(me.user);
    const pk = await apiFetch<{ credentials: Passkey[] }>("/api/auth/webauthn/credentials");
    setPasskeys(pk.credentials);
  }

  useEffect(() => {
    if (!hydrated || !authed) return;
    void reload().catch((e) => setErr(e instanceof Error ? e.message : "Load failed"));
  }, [hydrated, authed]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setBusy("profile");
    setErr(null);
    setMsg(null);
    try {
      const res = await apiFetch<{ user: MeUser }>("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({
          username: profileUsername,
          email: profileEmail,
        }),
      });
      setUser(res.user);
      setProfileUsername(res.user.username);
      setProfileEmail(res.user.email);
      markCookieSession(res.user);
      setMsg("Profile updated.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Profile update failed");
    } finally {
      setBusy(null);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (newPassword !== confirmPassword) {
      setErr("New passwords do not match");
      return;
    }
    const policyErr = validateNewPassword(newPassword);
    if (policyErr) {
      setErr(policyErr);
      return;
    }
    setBusy("password");
    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setMsg("Password changed — sign in again.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await logoutSession();
      router.push("/login");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Password change failed");
    } finally {
      setBusy(null);
    }
  }

  async function startTotpSetup() {
    setErr(null);
    setMsg(null);
    setBusy("totp-setup");
    try {
      const res = await apiFetch<{ secret: string; otpauthUrl: string }>(
        "/api/auth/totp/setup",
        { method: "POST", body: "{}" },
      );
      const qrDataUrl = await QRCode.toDataURL(res.otpauthUrl);
      setTotpSetup({ ...res, qrDataUrl });
      setMsg("Scan the QR code with your authenticator app, then enter a code to enable 2FA.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "TOTP setup failed");
    } finally {
      setBusy(null);
    }
  }

  async function enableTotp(e: React.FormEvent) {
    e.preventDefault();
    setBusy("totp-enable");
    setErr(null);
    try {
      const res = await apiFetch<{ recoveryCodes: string[] }>("/api/auth/totp/enable", {
        method: "POST",
        body: JSON.stringify({ code: totpCode }),
      });
      setRecoveryCodes(res.recoveryCodes);
      setTotpSetup(null);
      setTotpCode("");
      setMsg("Two-factor authentication enabled.");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Enable failed");
    } finally {
      setBusy(null);
    }
  }

  async function disableTotp(e: React.FormEvent) {
    e.preventDefault();
    setBusy("totp-disable");
    setErr(null);
    try {
      await apiFetch("/api/auth/totp/disable", {
        method: "POST",
        body: JSON.stringify({ currentPassword: disablePassword, code: disableCode }),
      });
      setDisablePassword("");
      setDisableCode("");
      setMsg("Two-factor authentication disabled.");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Disable failed");
    } finally {
      setBusy(null);
    }
  }

  async function addPasskey() {
    setBusy("passkey-add");
    setErr(null);
    try {
      const nickname = window.prompt("Passkey name (optional)", "My passkey") ?? undefined;
      const opts = await apiFetch<{ options: unknown; challengeId: string }>(
        "/api/auth/webauthn/register/options",
        { method: "POST", body: "{}" },
      );
      const attResp = await startRegistration({ optionsJSON: opts.options as never });
      await apiFetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        body: JSON.stringify({
          challengeId: opts.challengeId,
          response: attResp,
          nickname,
        }),
      });
      setMsg("Passkey registered.");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Passkey registration failed");
    } finally {
      setBusy(null);
    }
  }

  async function removePasskey(id: string) {
    if (!window.confirm("Remove this passkey?")) return;
    setBusy(`passkey-${id}`);
    setErr(null);
    try {
      await apiFetch(`/api/auth/webauthn/credentials/${id}`, { method: "DELETE" });
      setMsg("Passkey removed.");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(null);
    }
  }

  if (!hydrated || !checked) return <AuthLoadingShell />;
  if (!authed) return null;

  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Account settings</h1>
          <p className="mt-1 text-sm text-white/60">
            Manage password, two-factor authentication, and passkeys.
          </p>
        </div>

        {msg ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {msg}
          </div>
        ) : null}
        {err ? (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {err}
          </div>
        ) : null}

        <section className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-lg font-medium">Profile</h2>
          <form onSubmit={(e) => void saveProfile(e)} className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="text-white/70">Username</span>
              <input
                value={profileUsername}
                onChange={(e) => setProfileUsername(e.target.value)}
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-white/70">Email</span>
              <input
                value={profileEmail}
                onChange={(e) => setProfileEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
              />
            </label>
            <dl className="grid gap-2 text-sm">
              <div className="flex gap-2">
                <dt className="text-white/50">Role</dt>
                <dd>{user?.role ?? "…"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-white/50">2FA</dt>
                <dd>{user?.totpEnabled ? "Enabled" : "Disabled"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-white/50">Passkeys</dt>
                <dd>{user?.passkeyCount ?? 0}</dd>
              </div>
            </dl>
            <button
              type="submit"
              disabled={busy === "profile"}
              className="rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              {busy === "profile" ? "Saving…" : "Save profile"}
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-lg font-medium">Change password</h2>
          <p className="mt-1 text-xs text-white/50">{passwordPolicyHint()}</p>
          <form onSubmit={(e) => void changePassword(e)} className="mt-4 space-y-3">
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
            />
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy === "password"}
              className="rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              {busy === "password" ? "Saving…" : "Update password"}
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-lg font-medium">Two-factor authentication (TOTP)</h2>
          {!user?.totpEnabled ? (
            <div className="mt-3 space-y-4">
              {!totpSetup ? (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void startTotpSetup()}
                  className="rounded-md border border-[hsl(var(--accent))]/40 px-4 py-2 text-sm text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent))]/10 disabled:opacity-50"
                >
                  {busy === "totp-setup" ? "Preparing…" : "Set up authenticator app"}
                </button>
              ) : (
                <div className="space-y-3">
                  <img src={totpSetup.qrDataUrl} alt="TOTP QR code" className="h-40 w-40 rounded bg-white p-2" />
                  <p className="text-xs text-white/50 break-all">Secret: {totpSetup.secret}</p>
                  <form onSubmit={(e) => void enableTotp(e)} className="flex flex-wrap gap-2">
                    <input
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      placeholder="6-digit code"
                      className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={busy === "totp-enable"}
                      className="rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                    >
                      Enable 2FA
                    </button>
                  </form>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={(e) => void disableTotp(e)} className="mt-4 space-y-3">
              <p className="text-sm text-white/60">2FA is enabled on this account.</p>
              <input
                type="password"
                placeholder="Current password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
              />
              <input
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                placeholder="Authenticator code"
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={busy === "totp-disable"}
                className="rounded-md border border-red-500/40 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
              >
                Disable 2FA
              </button>
            </form>
          )}
          {recoveryCodes ? (
            <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-sm font-medium text-amber-200">Save these recovery codes now</p>
              <pre className="mt-2 text-xs text-amber-100/90">{recoveryCodes.join("\n")}</pre>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium">Passkeys</h2>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void addPasskey()}
              className="rounded-md bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20 disabled:opacity-50"
            >
              {busy === "passkey-add" ? "Waiting…" : "Add passkey"}
            </button>
          </div>
          <ul className="mt-4 space-y-2">
            {passkeys.map((pk) => (
              <li
                key={pk.id}
                className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2 text-sm"
              >
                <div>
                  <div>{pk.nickname ?? "Passkey"}</div>
                  <div className="text-xs text-white/40">
                    Added {new Date(pk.createdAt).toLocaleString()}
                    {pk.lastUsedAt
                      ? ` · Last used ${new Date(pk.lastUsedAt).toLocaleString()}`
                      : ""}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy === `passkey-${pk.id}`}
                  onClick={() => void removePasskey(pk.id)}
                  className="text-xs text-red-300 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
            {!passkeys.length ? (
              <li className="text-sm text-white/50">No passkeys registered yet.</li>
            ) : null}
          </ul>
        </section>

        {user?.role === "ADMIN" ? (
          <section className="rounded-xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-lg font-medium">Controller security</h2>
            <p className="mt-1 text-sm text-white/55">
              Runtime checks for weak secrets, TLS, and risky defaults. See{" "}
              <code className="text-xs">docs/SECURITY-AUDIT.md</code> for the full
              checklist.
            </p>
            <div className="mt-4">
              <SecurityChecklist admin />
            </div>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
