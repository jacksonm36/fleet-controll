"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import {
  AutomationQuickStart,
  AutomationSetupGuide,
  ToolPicker,
} from "@/components/AutomationQuickStart";
import { inputClass, selectClass } from "@/lib/automation";
import { JobLogs } from "@/components/JobLogs";
import { apiFetch } from "@/lib/api";
import type { AutomationTool } from "@/lib/automation";
import {
  defaultJobTypeForTool,
  jobTypesForTool,
  JOB_TYPE_LABELS,
} from "@/lib/automation";
import { usePolling } from "@/lib/usePolling";
import { useSession } from "@/lib/useSession";

type Script = {
  id: string;
  name: string;
  description: string | null;
  tool: AutomationTool;
  content: string;
  defaultPayload: Record<string, unknown> | null;
  tags: string[];
};

type AgentRow = {
  id: string;
  hostname: string;
  status: string;
  online: boolean;
  osType: string;
};

type JobRow = {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  agent?: { hostname: string };
};

const AUTOMATION_JOB_TYPES = new Set([
  "SHELL_SCRIPT",
  "ANSIBLE_PLAYBOOK",
  "ANSIBLE_ADHOC",
  "TERRAFORM_INIT",
  "TERRAFORM_PLAN",
  "TERRAFORM_APPLY",
]);

const QUICK_PRESETS = [
  { id: "hello-shell", match: "Hello shell", blurb: "Connectivity check" },
  { id: "ansible-ping", match: "Ansible ping", blurb: "ansible.builtin.ping" },
  { id: "terraform-smoke", match: "Terraform init smoke", blurb: "Minimal HCL" },
] as const;

function pickDefaultAgent(agents: AgentRow[], current: string): string {
  if (current && agents.some((a) => a.id === current)) return current;
  const online = agents.find((a) => a.online);
  return online?.id ?? agents[0]?.id ?? "";
}

export default function AutomationPage() {
  const router = useRouter();
  const { hydrated, checked, authed } = useSession();

  const [scripts, setScripts] = useState<Script[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [jobType, setJobType] = useState("");
  const [jobOpen, setJobOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formTool, setFormTool] = useState<AutomationTool>("shell");
  const [formContent, setFormContent] = useState("");
  const [formTags, setFormTags] = useState("automation");

  const selected = useMemo(
    () => scripts.find((s) => s.id === selectedId) ?? null,
    [scripts, selectedId],
  );

  const allowedJobTypes = useMemo(() => jobTypesForTool(formTool), [formTool]);

  const quickPresets = useMemo(
    () =>
      QUICK_PRESETS.map((q) => {
        const script = scripts.find((s) => s.name === q.match);
        return {
          id: script?.id ?? q.id,
          name: script?.name ?? q.match,
          tool: (script?.tool ?? "shell") as AutomationTool,
          blurb: q.blurb,
          scriptId: script?.id,
        };
      }),
    [scripts],
  );

  const reload = useCallback(async () => {
    const [s, a, j] = await Promise.all([
      apiFetch<Script[]>("/api/scripts", { cacheTtlMs: 0 }),
      apiFetch<AgentRow[]>("/api/agents", { cacheTtlMs: 0 }),
      apiFetch<JobRow[]>("/api/jobs", { cacheTtlMs: 0 }),
    ]);
    setScripts(s);
    setAgents(a);
    setAgentId((prev) => pickDefaultAgent(a, prev));
    setJobs(
      j
        .filter((row) => AUTOMATION_JOB_TYPES.has(row.type))
        .slice(0, 30),
    );
  }, []);

  useEffect(() => {
    if (scripts.length > 0 && !selectedId) {
      setSelectedId(scripts[0].id);
    }
  }, [scripts, selectedId]);

  useEffect(() => {
    if (!hydrated || !authed) return;
    setLoading(true);
    void reload()
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      )
      .finally(() => setLoading(false));
  }, [hydrated, authed, reload]);

  usePolling(() => {
    if (!hydrated || !authed) return;
    void reload().catch(() => undefined);
  }, 12_000, false);

  useEffect(() => {
    if (!selected) return;
    setFormName(selected.name);
    setFormDesc(selected.description ?? "");
    setFormTool(selected.tool);
    setFormContent(selected.content);
    setFormTags(selected.tags.join(", "));
    setJobType(defaultJobTypeForTool(selected.tool));
  }, [selected]);

  useEffect(() => {
    const types = jobTypesForTool(formTool);
    if (!types.includes(jobType)) {
      setJobType(types[0]);
    }
  }, [formTool, jobType]);

  async function runOnAgent(scriptId?: string) {
    if (!agentId) {
      setError("Enroll an agent first (Agents → Enroll new agent).");
      return;
    }
    setRunning(true);
    setError(null);
    setSuccess(null);
    try {
      const sid = scriptId ?? selectedId;
      if (!sid) {
        setError("Select a script from the library or use a quick-start preset.");
        return;
      }
      const script = scripts.find((s) => s.id === sid);
      if (!script) {
        setError("Script not found — refresh the page.");
        return;
      }
      const res = await apiFetch<{ job: JobRow }>(`/api/scripts/${sid}/run`, {
        method: "POST",
        body: JSON.stringify({
          agentId,
          jobType: jobType || defaultJobTypeForTool(script.tool),
        }),
      });
      setJobOpen(res.job.id);
      setSuccess(`Queued "${script.name}" on ${agents.find((a) => a.id === agentId)?.hostname ?? "agent"}.`);
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function saveScript() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: formName.trim() || "Untitled script",
        description: formDesc.trim() || undefined,
        tool: formTool,
        content: formContent,
        tags: formTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      if (selectedId) {
        await apiFetch(`/api/scripts/${selectedId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        const created = await apiFetch<Script>("/api/scripts", {
          method: "POST",
          body: JSON.stringify(body),
        });
        setSelectedId(created.id);
      }
      setSuccess("Script saved.");
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!hydrated || !checked) return <AuthLoadingShell />;
  if (!authed) {
    router.replace("/login");
    return null;
  }

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Automation</h1>
        <p className="mt-1 text-sm text-white/60">
          Run shell scripts, Ansible playbooks, and Terraform on enrolled agents.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {success}
        </div>
      )}

      <div className="space-y-6">
        <AutomationQuickStart
          agents={agents}
          agentId={agentId}
          onAgentChange={setAgentId}
          presets={quickPresets}
          onRunPreset={(id) => {
            const p = quickPresets.find((x) => x.id === id);
            if (p?.scriptId) void runOnAgent(p.scriptId);
            else setError("Preset script not loaded yet — wait a moment and retry.");
          }}
          running={running}
        />

        <AutomationSetupGuide
          collapsed={!setupOpen}
          onToggle={() => setSetupOpen((v) => !v)}
        />

        <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
          <aside className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            <div className="border-b border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white/50">
              Script library
            </div>
            {loading && scripts.length === 0 ? (
              <p className="px-3 py-4 text-sm text-white/50">Loading…</p>
            ) : (
              <ul className="max-h-[480px] overflow-y-auto p-2">
                {scripts.map((s) => (
                  <li key={s.id} className="mb-1">
                    <button
                      type="button"
                      className={`w-full rounded-md px-3 py-2.5 text-left transition ${
                        selectedId === s.id
                          ? "bg-[hsl(var(--accent))]/20 ring-1 ring-[hsl(var(--accent))]/50"
                          : "hover:bg-white/5"
                      }`}
                      onClick={() => setSelectedId(s.id)}
                    >
                      <div className="text-sm font-medium text-white">{s.name}</div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="text-xs capitalize text-[hsl(var(--accent))]">
                          {s.tool}
                        </span>
                        <button
                          type="button"
                          className="text-xs text-[hsl(var(--accent))] hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(s.id);
                            void runOnAgent(s.id);
                          }}
                        >
                          Run
                        </button>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-[hsl(var(--border))] p-2">
              <button
                type="button"
                className="w-full rounded-md border border-dashed border-[hsl(var(--border))] px-3 py-2 text-sm text-white/70 hover:bg-white/5"
                onClick={() => {
                  setSelectedId(null);
                  setFormName("New script");
                  setFormContent("#!/bin/bash\necho hello\n");
                  setFormTool("shell");
                }}
              >
                + New script
              </button>
            </div>
          </aside>

          <div className="space-y-4">
            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-lg">
              <div>
                <div className="text-sm font-medium text-white">
                  {selected?.name ?? "New script"}
                </div>
                <div className="text-xs text-white/50">
                  {selected?.description ?? "Edit below, then save or run"}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-[hsl(var(--border))] px-4 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-40"
                  disabled={saving}
                  onClick={() => void saveScript()}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className="rounded-md bg-[hsl(var(--accent))] px-5 py-2 text-sm font-semibold text-black disabled:opacity-40"
                  disabled={running || !agentId || !selectedId}
                  onClick={() => void runOnAgent()}
                >
                  {running ? "Running…" : "▶ Run on agent"}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 space-y-4">
              <div>
                <span className="text-xs text-white/50">Tool</span>
                <div className="mt-2">
                  <ToolPicker value={formTool} onChange={setFormTool} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-white/50">Name</span>
                  <input
                    className={inputClass}
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-white/50">Job action</span>
                  <select
                    className={selectClass}
                    value={jobType || allowedJobTypes[0]}
                    onChange={(e) => setJobType(e.target.value)}
                  >
                    {allowedJobTypes.map((t) => (
                      <option key={t} value={t}>
                        {JOB_TYPE_LABELS[t] ?? t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="text-white/50">Description</span>
                  <input
                    className={inputClass}
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                  />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="text-white/50">Tags</span>
                  <input
                    className={inputClass}
                    value={formTags}
                    onChange={(e) => setFormTags(e.target.value)}
                    placeholder="demo, prod"
                  />
                </label>
              </div>

              <label className="block text-sm">
                <span className="text-white/50">Script / playbook / HCL</span>
                <textarea
                  className="mt-1 h-72 w-full rounded-md border border-[hsl(var(--border))] bg-[#0d1117] p-3 font-mono text-sm text-emerald-100/90"
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  spellCheck={false}
                />
              </label>

              {selectedId && (
                <button
                  type="button"
                  className="text-sm text-red-400 hover:underline"
                  onClick={async () => {
                    if (!confirm("Delete this script?")) return;
                    await apiFetch(`/api/scripts/${selectedId}`, { method: "DELETE" });
                    setSelectedId(null);
                    await reload();
                  }}
                >
                  Delete script
                </button>
              )}
            </div>
          </div>
        </div>

        <section>
          <h2 className="mb-3 text-lg font-medium text-white">Recent jobs</h2>
          {agents.length === 0 && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              No agents yet.{" "}
              <Link href="/agents#enroll" className="font-medium underline">
                Enroll your first agent
              </Link>{" "}
              to run automation.
            </div>
          )}
          <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))]">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-white/50">
                <tr>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Agent</th>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-white/45">
                      No jobs yet — use Quick start above to run Hello shell.
                    </td>
                  </tr>
                ) : (
                  jobs.map((j) => (
                    <tr key={j.id} className="border-t border-[hsl(var(--border))]">
                      <td className="px-3 py-2">
                        {JOB_TYPE_LABELS[j.type] ?? j.type}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            j.status === "COMPLETED"
                              ? "text-emerald-400"
                              : j.status === "FAILED"
                                ? "text-red-400"
                                : "text-amber-300"
                          }
                        >
                          {j.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">{j.agent?.hostname ?? "—"}</td>
                      <td className="px-3 py-2 text-white/60">
                        {new Date(j.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="font-medium text-[hsl(var(--accent))] hover:underline"
                          onClick={() => setJobOpen(j.id)}
                        >
                          View logs
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <JobLogs
            jobId={jobOpen}
            open={!!jobOpen}
            onClose={() => setJobOpen(null)}
          />
        </section>
      </div>
    </Shell>
  );
}
