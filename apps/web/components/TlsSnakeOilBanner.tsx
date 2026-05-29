"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type TlsInfo = {
  publicUrl: string;
  caDownloadUrl: string;
  caAvailable: boolean;
  controllerHost: string;
  tlsProxy?: string;
  sslCertPath?: string;
  sslKeyPath?: string;
};

function originHttps(): string {
  if (typeof window === "undefined") return "";
  const o = window.location.origin;
  if (o.startsWith("http://")) {
    return o.replace(/^http:/, "https:").replace(/:3000$/, "");
  }
  return o.replace(/:3000$/, "");
}

/** nginx-style TLS notice on the dashboard (standard ssl_certificate, not Caddy internal CA). */
export function TlsSnakeOilBanner() {
  const [info, setInfo] = useState<TlsInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch<TlsInfo>("/api/fleet/tls-setup", {
        cacheTtlMs: 30_000,
      });
      setInfo(d);
    } catch {
      const base = originHttps();
      setInfo({
        publicUrl: base,
        caDownloadUrl: `${base}/api/public/tls-ca.crt`,
        caAvailable: true,
        controllerHost: window.location.hostname,
        tlsProxy: "nginx",
      });
    }
  }, []);

  useEffect(() => {
    void load();
    try {
      setDismissed(localStorage.getItem("fleet:tls-banner-dismissed") === "1");
    } catch {
      /* ignore */
    }
  }, [load]);

  if (typeof window !== "undefined" && window.location.protocol !== "https:") {
    return null;
  }
  if (dismissed || !info) return null;

  const caUrl = info.caDownloadUrl;

  return (
    <section className="overflow-hidden rounded-xl border border-amber-500/40 bg-gradient-to-b from-amber-950/30 to-[hsl(var(--card))]">
      <div className="flex items-center gap-2 border-b border-amber-500/25 bg-amber-900/20 px-4 py-2">
        <span className="text-sm font-semibold text-amber-200">
          HTTPS via nginx — trust certificate (self-signed)
        </span>
        <button
          type="button"
          className="ml-auto text-xs text-white/50 hover:text-white"
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem("fleet:tls-banner-dismissed", "1");
            } catch {
              /* ignore */
            }
          }}
        >
          Dismiss
        </button>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto]">
        <div className="space-y-3 text-sm text-white/75">
          <p>
            Fleet uses a <strong className="text-white/90">normal nginx</strong>{" "}
            reverse proxy with{" "}
            <code className="text-[hsl(var(--accent))]">ssl_certificate</code> and{" "}
            <code className="text-[hsl(var(--accent))]">ssl_certificate_key</code>{" "}
            (same as any standard web server). Agent traffic uses the same HTTPS
            endpoint: <strong className="text-white/80">{info.publicUrl}</strong>.
          </p>
          <div className="rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs">
            <div className="text-white/45">nginx (preview)</div>
            <div className="mt-1">
              ssl_certificate {info.sslCertPath ?? "/etc/fleet/ssl/fullchain.pem"};
            </div>
            <div>
              ssl_certificate_key {info.sslKeyPath ?? "/etc/fleet/ssl/privkey.pem"};
            </div>
            <div className="mt-2 text-white/55">
              Replace with Let&apos;s Encrypt or your own PEM files, then{" "}
              <code className="text-xs">sudo nginx -t &amp;&amp; systemctl reload nginx</code>
            </div>
          </div>
          <p className="text-xs text-white/55">
            If you use a public CA (Let&apos;s Encrypt), agents need no extra CA file.
            For the default openssl self-signed cert, download and trust the PEM once
            in your browser, then enroll below.
          </p>
        </div>

        <div className="flex flex-col justify-center gap-2 lg:min-w-[200px]">
          <a
            href={caUrl}
            download="fleet-controller-ca.crt"
            className="rounded-md bg-[hsl(var(--accent))] px-4 py-2.5 text-center text-sm font-semibold text-black hover:opacity-90"
          >
            Download certificate
          </a>
          <button
            type="button"
            className="rounded-md border border-[hsl(var(--border))] px-4 py-2 text-sm text-white/80 hover:bg-white/5"
            onClick={() => {
              void navigator.clipboard.writeText(caUrl).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? "Copied URL" : "Copy cert URL"}
          </button>
          <Link href="/tls" className="text-center text-xs text-[hsl(var(--accent))] hover:underline">
            nginx TLS guide →
          </Link>
        </div>
      </div>
    </section>
  );
}
