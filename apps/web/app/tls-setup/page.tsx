"use client";

import Link from "next/link";
import { TlsSetupPanel } from "@/components/TlsSetupPanel";

/** Public CA trust instructions (no login required). */
export default function TlsSetupPublicPage() {
  const loginHref =
    typeof window !== "undefined" && window.location.pathname === "/tls-setup"
      ? "/login"
      : "/login";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--background))] p-6">
      <div className="w-full max-w-2xl space-y-4">
        <div className="text-center">
          <div className="text-sm font-semibold tracking-wide text-[hsl(var(--accent))]">
            Fleet Control
          </div>
          <h1 className="mt-2 text-xl font-semibold">HTTPS (nginx)</h1>
          <p className="mt-1 text-sm text-white/60">
            Import the controller certificate if using the default self-signed PEM.
          </p>
        </div>
        <TlsSetupPanel publicOnly />
        <p className="text-center text-sm text-white/50">
          After importing the CA,{" "}
          <Link href={loginHref} className="text-[hsl(var(--accent))] hover:underline">
            sign in to Fleet
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
