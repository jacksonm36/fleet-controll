"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import { apiFetch } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { passwordPolicyHint } from "@/lib/password-policy";
import { useSession } from "@/lib/useSession";
import { useRouter } from "next/navigation";

type UserRow = {
  id: string;
  username: string;
  email: string;
  role: string;
  disabled: boolean;
  totpEnabled: boolean;
  passkeyCount: number;
  createdAt: string;
};

export default function AdminUsersPage() {
  const router = useRouter();
  const { hydrated, checked, authed } = useSession();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("OPERATOR");
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("OPERATOR");
  const [editDisabled, setEditDisabled] = useState(false);
  const [editPassword, setEditPassword] = useState("");

  async function reload() {
    const users = await apiFetch<UserRow[]>("/api/users");
    setRows(users);
  }

  useEffect(() => {
    if (!hydrated || !authed) return;
    const me = getSessionUser();
    if (me?.role !== "ADMIN") {
      router.replace("/settings");
      return;
    }
    void reload().catch((e) => setErr(e instanceof Error ? e.message : "Load failed"));
  }, [hydrated, authed, router]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    setErr(null);
    try {
      await apiFetch("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username: newUsername.trim() || undefined,
          email: newEmail,
          password: newPassword,
          role: newRole,
        }),
      });
      setShowCreate(false);
      setNewUsername("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("OPERATOR");
      setMsg("User created.");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(null);
    }
  }

  async function updateUser(id: string, patch: Record<string, unknown>) {
    setBusy(id);
    setErr(null);
    try {
      await apiFetch(`/api/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setMsg("User updated.");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function deleteUser(id: string, email: string) {
    if (!window.confirm(`Delete user ${email}?`)) return;
    setBusy(`del-${id}`);
    setErr(null);
    try {
      await apiFetch(`/api/users/${id}`, { method: "DELETE" });
      setMsg("User deleted.");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  function openEdit(user: UserRow) {
    setEditing(user);
    setEditUsername(user.username);
    setEditEmail(user.email);
    setEditRole(user.role);
    setEditDisabled(user.disabled);
    setEditPassword("");
    setErr(null);
    setMsg(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(`edit-${editing.id}`);
    setErr(null);
    try {
      const patch: Record<string, unknown> = {
        username: editUsername,
        email: editEmail,
        role: editRole,
        disabled: editDisabled,
      };
      if (editPassword.trim()) patch.password = editPassword;
      await apiFetch(`/api/users/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setMsg("User updated.");
      setEditing(null);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  if (!hydrated || !checked) return <AuthLoadingShell />;
  if (!authed) return null;

  return (
    <Shell>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">User management</h1>
            <p className="text-sm text-white/60">
              Create accounts, assign roles, disable users, and reset passwords.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black"
          >
            {showCreate ? "Cancel" : "New user"}
          </button>
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

        {showCreate ? (
          <form
            onSubmit={(e) => void createUser(e)}
            className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-3 max-w-lg"
          >
            <h2 className="font-medium">Create user</h2>
            <p className="text-xs text-white/50">{passwordPolicyHint()}</p>
            <input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Username (optional)"
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
            />
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Email"
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
            >
              <option value="ADMIN">Admin</option>
              <option value="OPERATOR">Operator</option>
              <option value="VIEWER">Viewer</option>
            </select>
            <button
              type="submit"
              disabled={busy === "create"}
              className="rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              {busy === "create" ? "Creating…" : "Create user"}
            </button>
          </form>
        ) : null}

        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase text-white/50">
              <tr>
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">2FA</th>
                <th className="px-4 py-3">Passkeys</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-white/10">
                  <td className="px-4 py-3">{u.username}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      disabled={busy === u.id}
                      onChange={(e) => void updateUser(u.id, { role: e.target.value })}
                      className="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs"
                    >
                      <option value="ADMIN">Admin</option>
                      <option value="OPERATOR">Operator</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={busy === u.id}
                      onClick={() => void updateUser(u.id, { disabled: !u.disabled })}
                      className={
                        u.disabled
                          ? "text-amber-300 hover:underline"
                          : "text-emerald-300 hover:underline"
                      }
                    >
                      {u.disabled ? "Disabled" : "Active"}
                    </button>
                  </td>
                  <td className="px-4 py-3">{u.totpEnabled ? "On" : "Off"}</td>
                  <td className="px-4 py-3">{u.passkeyCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => openEdit(u)}
                        className="text-xs text-white/80 hover:underline disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => {
                          const pw = window.prompt("New password for this user");
                          if (pw) void updateUser(u.id, { password: pw });
                        }}
                        className="text-xs text-[hsl(var(--accent))] hover:underline disabled:opacity-50"
                      >
                        Reset password
                      </button>
                      <button
                        type="button"
                        disabled={busy === `del-${u.id}`}
                        onClick={() => void deleteUser(u.id, u.email)}
                        className="text-xs text-red-300 hover:underline disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-white/50">
                    No users found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {editing ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <form
              onSubmit={(e) => void saveEdit(e)}
              className="w-full max-w-md rounded-xl border border-white/10 bg-[hsl(var(--card))] p-5 space-y-3"
            >
              <h2 className="text-lg font-medium">Edit user</h2>
              <input
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                placeholder="Username"
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
              />
              <input
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="Email"
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
              />
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
              >
                <option value="ADMIN">Admin</option>
                <option value="OPERATOR">Operator</option>
                <option value="VIEWER">Viewer</option>
              </select>
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={editDisabled}
                  onChange={(e) => setEditDisabled(e.target.checked)}
                />
                Disabled
              </label>
              <input
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                placeholder="New password (optional)"
                className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
              />
              <p className="text-xs text-white/50">{passwordPolicyHint()}</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-md px-3 py-2 text-sm text-white/70 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy === `edit-${editing.id}`}
                  className="rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                >
                  {busy === `edit-${editing.id}` ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
