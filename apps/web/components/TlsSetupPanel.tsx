"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type TlsSetupInfo = {
  tlsRequired: boolean;
  publicUrl: string;
  caAvailable: boolean;
  caDownloadUrl: string;
  controllerHost: string;
  tlsProxy?: string;
  sslCertPath?: string;
  sslKeyPath?: string;
  issuer: string;
};

function publicOrigin(): string {
  if (typeof window === "undefined") return "";
  const o = window.location.origin;
  if (o.startsWith("http://")) {
    return o.replace(/^http:/, "https:").replace(/:3000$/, "");
  }
  return o.replace(/:3000$/, "");
}

function fallbackInfo(): TlsSetupInfo {
  const base = publicOrigin();
  return {
    tlsRequired: true,
    publicUrl: base,
    caAvailable: true,
    caDownloadUrl: `${base}/api/public/tls-ca.crt`,
    controllerHost: typeof window !== "undefined" ? window.location.hostname : "",
    tlsProxy: "nginx",
    sslCertPath: "/etc/fleet/ssl/fullchain.pem",
    sslKeyPath: "/etc/fleet/ssl/privkey.pem",
    issuer: "Fleet TLS (nginx)",
  };
}

export function TlsSetupPanel({
  compact = false,
  publicOnly = false,
}: {
  compact?: boolean;
  publicOnly?: boolean;
}) {
  const [info, setInfo] = useState<TlsSetupInfo | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (publicOnly) {
      setInfo(fallbackInfo());
      return;
    }
    try {
      const data = await apiFetch<TlsSetupInfo>("/api/fleet/tls-setup", {
        cacheTtlMs: 60_000,
      });
      setInfo(data);
    } catch {
      setInfo(fallbackInfo());
    }
  }, [publicOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!info) {
    return (
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-sm text-white/50">
        Loading TLS setup…
      </div>
    );
  }

  const caUrl = info.caDownloadUrl || `${info.publicUrl}/api/public/tls-ca.crt`;

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-6"}>
      <div
        className={
          compact
            ? "rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
            : "rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"
        }
      >
        <h2 className={compact ? "text-sm font-semibold" : "text-lg font-semibold"}>
          TLS via nginx (standard web server)
        </h2>
        <p className="mt-2 text-sm text-white/60">
          HTTPS terminates on <strong>nginx</strong> with normal certificate files —
          not Caddy internal CA. UI and agents both use{" "}
          <strong className="text-white/80">{info.publicUrl}</strong>.
        </p>

        <pre className="mt-3 overflow-auto rounded-md bg-black/40 p-3 text-xs text-white/80">
          {`server {
  listen 443 ssl;
  ssl_certificate     ${info.sslCertPath ?? "/etc/fleet/ssl/fullchain.pem"};
  ssl_certificate_key ${info.sslKeyPath ?? "/etc/fleet/ssl/privkey.pem"};
  # proxy_pass → fleet-web :3000, fleet-api :4000
}`}
        </pre>

        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={caUrl}
            download="fleet-controller-ca.crt"
            className="rounded-md bg-[hsl(var(--accent))] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
          >
            Download certificate (.pem)
          </a>
          <button
            type="button"
            className="rounded-md border border-[hsl(var(--border))] px-3 py-2 text-sm text-white/80 hover:bg-white/5"
            onClick={() => void copyText("url", caUrl)}
          >
            {copied === "url" ? "Copied" : "Copy cert URL"}
          </button>
        </div>

        {!info.caAvailable ? (
          <p className="mt-3 text-sm text-amber-300">
            No certificate on disk yet. Run{" "}
            <code className="text-xs">sudo bash scripts/setup-fleet-tls-nginx.sh</code>
          </p>
        ) : null}
      </div>

      {!compact ? (
        <>
          <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-white/50">
              Browser (self-signed only)
            </h3>
            <p className="mt-2 text-sm text-white/65">
              Import the downloaded PEM into Trusted Root (Windows) or Authorities
              (Firefox), restart the browser, then use Fleet at {info.publicUrl}.
            </p>
          </section>

          <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-white/50">
              Linux agents (encrypted enroll)
            </h3>
            <pre className="mt-3 overflow-auto rounded-md bg-black/40 p-3 text-xs text-white/80">
              {`# Install script downloads the cert to ~/.fleet/ca.crt when needed
# and writes FLEET_CA_FILE into ~/.config/fleet-agent/env for systemd/cron.

curl -fsSL '${caUrl}' -o /etc/fleet/ca.crt   # manual only (optional)
export FLEET_CA_FILE=/etc/fleet/ca.crt
export FLEET_CENTRAL_URL=${info.publicUrl}
# Public CA (Let's Encrypt): install script skips FLEET_CA_FILE automatically`}
            </pre>
            <button
              type="button"
              className="mt-2 text-xs text-[hsl(var(--accent))] hover:underline"
              onClick={() =>
                void copyText(
                  "agent",
                  `export FLEET_CENTRAL_URL=${info.publicUrl}\n# optional for self-signed:\nexport FLEET_CA_FILE=/etc/fleet/ca.crt`,
                )
              }
            >
              {copied === "agent" ? "Copied" : "Copy agent env"}
            </button>
          </section>

          <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-white/50">
              Controller setup
            </h3>
            <pre className="mt-3 overflow-auto rounded-md bg-black/40 p-3 text-xs text-white/80">
              {`export FLEET_DOMAIN=${info.controllerHost || "YOUR_HOST"}
# Optional: use your own cert
# export FLEET_SSL_CERT=/path/to/fullchain.pem
# export FLEET_SSL_KEY=/path/to/privkey.pem
sudo bash scripts/setup-fleet-tls-nginx.sh
sudo systemctl restart fleet-api fleet-web nginx`}
            </pre>
          </section>
        </>
      ) : null}
    </div>
  );
}
