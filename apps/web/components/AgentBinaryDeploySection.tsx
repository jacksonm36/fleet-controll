"use client";

import { useState } from "react";
import {
  buildAgentBinaryUpgradeHttpsCommand,
  buildAgentReinstallCommand,
  buildFixAgentConnectionCommand,
} from "@/lib/enrollment-install";

function CopyLine({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-white/45">{label}</span>
        <button
          type="button"
          className="text-[10px] text-[hsl(var(--accent))] hover:underline"
          onClick={() => {
            void navigator.clipboard.writeText(command).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-auto rounded bg-black/30 p-2 text-[10px] text-white/70">
        {command}
      </pre>
    </div>
  );
}

type ReleaseInfo = {
  built: boolean;
  hint?: string;
  manifest?: { version: string; buildId: string; builtAt: string };
};

export function AgentBinaryDeploySection({
  release,
  outdatedCount,
  pushMsg,
  pushing,
  onPush,
  onOpenConsole,
}: {
  release: ReleaseInfo | null;
  outdatedCount: number;
  pushMsg: string | null;
  pushing: boolean;
  onPush: () => void;
  onOpenConsole: () => void;
}) {
  const [showHostCmds, setShowHostCmds] = useState(false);

  return (
    <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase text-white/50">Agent binary &amp; updates</div>
          {release?.manifest ? (
            <p className="mt-1 text-sm text-white/80">
              Controller build{" "}
              <code className="text-[hsl(var(--accent))]">
                {release.manifest.version}+{release.manifest.buildId}
              </code>
              <span className="text-white/50">
                {" "}
                · built {new Date(release.manifest.builtAt).toLocaleString()}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-amber-200/90">
              {release?.hint ??
                "No agent binary manifest — run rebuild on the controller."}
            </p>
          )}
          <p className="mt-2 text-xs text-white/50">
            Push updates to online agents from here, or run host commands below for
            manual upgrade / reinstall. Auto-update on heartbeat (~15s) unless{" "}
            <code className="text-white/60">FLEET_AUTO_UPDATE=0</code>.
          </p>
          {outdatedCount > 0 ? (
            <p className="mt-1 text-xs text-amber-200">
              {outdatedCount} online agent(s) running an older build.
            </p>
          ) : null}
          {pushMsg ? <p className="mt-2 text-xs text-white/70">{pushMsg}</p> : null}
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-white/20 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
              onClick={onOpenConsole}
            >
              Deploy console
            </button>
            <button
              type="button"
              disabled={pushing || !release?.manifest}
              className="rounded-md bg-[hsl(var(--accent))] px-3 py-2 text-xs font-semibold text-black hover:opacity-90 disabled:opacity-50"
              onClick={onPush}
            >
              {pushing ? "Pushing…" : "Push update to online agents"}
            </button>
          </div>
          <code className="max-w-md text-right text-[10px] text-white/40">
            Controller: bash scripts/rebuild-fleet-agent.sh
          </code>
        </div>
      </div>

      <details
        className="mt-4 rounded-lg border border-white/10 bg-black/20"
        open={showHostCmds}
        onToggle={(e) => setShowHostCmds((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-white/60 hover:text-white">
          Host commands (upgrade / reinstall / fix connection)
        </summary>
        <div className="space-y-3 border-t border-white/10 px-3 py-3">
          <CopyLine
            label="Upgrade agent binary on host (already enrolled)"
            command={buildAgentBinaryUpgradeHttpsCommand()}
          />
          <CopyLine
            label="Re-install agent (keep enrollment token)"
            command={buildAgentReinstallCommand()}
          />
          <CopyLine
            label="Fix TLS / systemd / heartbeat"
            command={buildFixAgentConnectionCommand()}
          />
        </div>
      </details>
    </section>
  );
}
