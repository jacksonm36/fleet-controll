"use client";

import Link from "next/link";
import { httpsPublicUrl } from "@/lib/enrollment-install";

/** Short TLS note on Enrollment — full guide at /tls. */
export function EnrollmentTlsNote() {
  const publicUrl = httpsPublicUrl();

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm text-white/65">
      <p>
        <strong className="text-white/85">HTTPS via nginx</strong> at{" "}
        <code className="text-[hsl(var(--accent))]">{publicUrl}</code>. The install
        command below trusts the controller certificate automatically — you only need
        to import the PEM in your <strong className="text-white/80">browser</strong> if
        this page shows a certificate warning.
      </p>
      <Link
        href="/tls"
        className="mt-2 inline-block text-xs text-[hsl(var(--accent))] hover:underline"
      >
        Browser cert import &amp; nginx setup →
      </Link>
    </div>
  );
}
