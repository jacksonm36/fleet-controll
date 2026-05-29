"use client";

import Link from "next/link";
import { Shell } from "@/components/Shell";
import { AuthLoadingShell } from "@/components/AuthLoadingShell";
import { TlsSetupPanel } from "@/components/TlsSetupPanel";
import { useSession } from "@/lib/useSession";

export default function TlsSetupPage() {
  const { hydrated, checked, authed } = useSession();

  if (!hydrated || !checked) return <AuthLoadingShell />;
  if (!authed) return null;

  return (
    <Shell>
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">TLS &amp; nginx setup</h1>
          <p className="text-sm text-white/60">
            Standard HTTPS like any nginx site: ssl_certificate files on the
            controller, same URL for the web UI and agents.
          </p>
        </div>
        <TlsSetupPanel />
        <p className="text-sm text-white/50">
          Next:{" "}
          <Link href="/agents#enroll" className="text-[hsl(var(--accent))] hover:underline">
            Agent enrollment
          </Link>{" "}
          to install agents over HTTPS.
        </p>
      </div>
    </Shell>
  );
}
