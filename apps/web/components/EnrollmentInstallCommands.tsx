"use client";

import { useState } from "react";
import {
  INSTALL_SUCCESS_HINT,
  buildAgentInstallCommand,
  buildAgentInstallHttpsCommand,
  buildAgentInstallViaWebProxy,
  buildAgentReinstallCommand,
  httpsPublicUrl,
} from "@/lib/enrollment-install";

function CopyBlock({
  label,
  command,
  primary = false,
}: {
  label: string;
  command: string;
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span
          className={
            primary
              ? "text-xs font-semibold uppercase tracking-wide text-emerald-300"
              : "text-xs text-white/50"
          }
        >
          {label}
        </span>
        <button
          type="button"
          className={
            primary
              ? "shrink-0 rounded-md bg-[hsl(var(--accent))] px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90"
              : "shrink-0 text-xs text-[hsl(var(--accent))] hover:underline"
          }
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
      <pre className="overflow-auto rounded-md bg-black/40 p-3 text-[11px] leading-relaxed text-white/85">
        {command}
      </pre>
    </div>
  );
}

export function EnrollmentInstallCommands({
  token,
  expiresAt,
}: {
  token: string;
  expiresAt?: string | null;
}) {
  const httpsBase = httpsPublicUrl();

  return (
    <div className="space-y-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-6">
      <div className="text-xs uppercase tracking-wide text-emerald-200">
        Copy once · expires{" "}
        {expiresAt ? new Date(expiresAt).toLocaleString() : "soon"}
      </div>

      <div className="space-y-1">
        <span className="text-xs text-white/50">Pairing secret</span>
        <code className="block break-all rounded-md bg-black/40 px-3 py-2 text-xs text-white/90">
          {token}
        </code>
      </div>

      <p className="text-sm text-white/70">
        Run on the <strong className="text-white">agent host</strong> (Linux / WSL).
        The installer is fetched over plain HTTP on port{" "}
        <code className="text-[hsl(var(--accent))]">4000</code> (no certificate
        prompt), then downloads the nginx certificate and enrolls on{" "}
        <code className="text-[hsl(var(--accent))]">{httpsBase}</code>.
      </p>

      <CopyBlock
        label="Recommended install"
        command={buildAgentInstallCommand(token)}
        primary
      />

      <details className="group rounded-lg border border-white/10 bg-black/20">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-white/60 hover:text-white">
          More install options
        </summary>
        <div className="space-y-4 border-t border-white/10 px-3 py-3">
          <CopyBlock
            label="Via web proxy (port 3000)"
            command={buildAgentInstallViaWebProxy(token)}
          />
          <CopyBlock
            label="HTTPS only (add -k for self-signed cert)"
            command={buildAgentInstallHttpsCommand(token)}
          />
          <CopyBlock
            label="Re-install binary only (already enrolled)"
            command={buildAgentReinstallCommand()}
          />
        </div>
      </details>

      <div className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/55">
        <p className="font-medium text-white/70">Expected output (new installer)</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5 font-mono text-[10px]">
          {INSTALL_SUCCESS_HINT.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-2 text-white/50">
          Install configures TLS, systemd, and verifies heartbeats automatically. Each enrollment
          token works once.
        </p>
      </div>
    </div>
  );
}
