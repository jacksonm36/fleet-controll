"use client";

import Link from "next/link";
import type { AutomationTool } from "@/lib/automation";
import { AUTOMATION_TOOLS, selectClass, SETUP_STEPS } from "@/lib/automation";

type AgentRow = {
  id: string;
  hostname: string;
  online: boolean;
  osType?: string;
};

type QuickPreset = {
  id: string;
  name: string;
  tool: AutomationTool;
  blurb: string;
};

export function AutomationQuickStart({
  agents,
  agentId,
  onAgentChange,
  presets,
  onRunPreset,
  running,
}: {
  agents: AgentRow[];
  agentId: string;
  onAgentChange: (id: string) => void;
  presets: QuickPreset[];
  onRunPreset: (presetId: string) => void;
  running: boolean;
}) {
  const online = agents.filter((a) => a.online);
  const selected = agents.find((a) => a.id === agentId);

  return (
    <section className="rounded-xl border-2 border-[hsl(var(--accent))]/40 bg-gradient-to-br from-[hsl(var(--accent))]/10 to-transparent p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--accent))]">
            Quick start
          </p>
          <h2 className="text-lg font-semibold text-white">Run automation in 3 steps</h2>
          <p className="mt-1 max-w-xl text-sm text-white/70">
            Choose a host, pick a starter script, and click Run. No editing required for demos.
          </p>
        </div>
        <Link
          href="/agents#enroll"
          className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-sm text-white/90 hover:bg-white/10"
        >
          + Enroll agent
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]/80 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-xs font-bold text-black">
              1
            </span>
            <span className="font-medium text-white">Target agent</span>
          </div>
          {agents.length === 0 ? (
            <div className="space-y-2 text-sm text-amber-200/90">
              <p>No agents enrolled yet.</p>
              <Link
                href="/agents#enroll"
                className="inline-block font-medium text-[hsl(var(--accent))] hover:underline"
              >
                Create enrollment token →
              </Link>
            </div>
          ) : (
            <>
              <label className="block text-xs text-white/50">Runs on this host</label>
              <select
                className={selectClass}
                value={agentId}
                onChange={(e) => onAgentChange(e.target.value)}
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.hostname} — {a.online ? "online" : "offline"}
                    {a.osType ? ` (${a.osType})` : ""}
                  </option>
                ))}
              </select>
              {selected && !selected.online && (
                <p className="mt-2 text-xs text-amber-300/90">
                  Agent is offline; job will queue until it reconnects.
                </p>
              )}
              {online.length > 0 && (
                <p className="mt-2 text-xs text-white/50">
                  {online.length} online · {agents.length} total
                </p>
              )}
            </>
          )}
        </div>

        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]/80 p-4 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-xs font-bold text-black">
              2
            </span>
            <span className="font-medium text-white">Starter scripts</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={running || !agentId}
                onClick={() => onRunPreset(p.id)}
                className="rounded-lg border border-[hsl(var(--border))] bg-[#1a2332] p-3 text-left transition hover:border-[hsl(var(--accent))]/60 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <div className="text-sm font-medium text-white">{p.name}</div>
                <div className="mt-0.5 text-xs capitalize text-[hsl(var(--accent))]">
                  {p.tool}
                </div>
                <div className="mt-1 text-xs text-white/50">{p.blurb}</div>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-white/45">
            Step 3: click a card above — job logs appear at the bottom of this page.
          </p>
        </div>
      </div>
    </section>
  );
}

export function AutomationSetupGuide({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-white hover:bg-white/5"
        onClick={onToggle}
      >
        <span>Setup guide — enrollment, Ansible, Terraform on agents</span>
        <span className="text-white/50">{collapsed ? "Show" : "Hide"}</span>
      </button>
      {!collapsed && (
        <div className="grid gap-3 border-t border-[hsl(var(--border))] p-4 md:grid-cols-3">
          {SETUP_STEPS.map((step, i) => (
            <div key={step.title} className="rounded-md bg-black/20 p-3">
              <div className="text-xs text-[hsl(var(--accent))]">Step {i + 1}</div>
              <div className="mt-1 font-medium text-white">{step.title}</div>
              <p className="mt-1 text-xs text-white/60">{step.body}</p>
              <Link
                href={step.href}
                className="mt-2 inline-block text-xs font-medium text-[hsl(var(--accent))] hover:underline"
              >
                {step.cta} →
              </Link>
            </div>
          ))}
          <div className="md:col-span-3 rounded-md border border-dashed border-[hsl(var(--border))] p-3 text-xs text-white/55">
            <strong className="text-white/80">Agent requirements:</strong> Shell needs bash or
            PowerShell. Ansible jobs need <code className="text-[hsl(var(--accent))]">ansible-playbook</code>{" "}
            on PATH. Terraform jobs need <code className="text-[hsl(var(--accent))]">terraform</code> or{" "}
            <code className="text-[hsl(var(--accent))]">tofu</code>. Rebuild the Go agent after
            controller updates: <code className="text-white/70">cd agent && go build -o bin/fleet-agent ./cmd/agent</code>
          </div>
        </div>
      )}
    </section>
  );
}

export function ToolPicker({
  value,
  onChange,
}: {
  value: AutomationTool;
  onChange: (t: AutomationTool) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {AUTOMATION_TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.hint}
          onClick={() => onChange(t.id)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
            value === t.id
              ? "border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/20 text-[hsl(var(--accent))]"
              : "border-[hsl(var(--border))] text-white/70 hover:border-white/30 hover:text-white"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export { selectClass };
