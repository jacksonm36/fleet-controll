"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@fleet/ui";
import { getSessionUser, logoutSession } from "@/lib/auth";

const nav: { href: string; label: string; highlight?: boolean }[] = [
  { href: "/", label: "Fleet" },
  { href: "/automation", label: "Automation", highlight: true },
  { href: "/agents", label: "Agents" },
  { href: "/monitoring", label: "Monitoring" },
  { href: "/patches", label: "Patches" },
  { href: "/vulnerabilities", label: "CVEs" },
  { href: "/tls", label: "TLS (nginx)" },
  { href: "/crowdsec", label: "CrowdSec" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    setRole(getSessionUser()?.role ?? null);
  }, [pathname]);

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <div className="border-b border-[hsl(var(--border))] px-4 py-4">
        <div className="text-sm font-semibold tracking-wide text-[hsl(var(--accent))]">
          Fleet Control
        </div>
        <div className="text-xs text-[hsl(var(--muted))]">Patch · Ansible · Terraform</div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {nav.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm transition-colors hover:bg-white/5",
                active
                  ? "border-l-2 border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/15 pl-[10px] font-semibold text-white"
                  : "text-white/70",
                "highlight" in item &&
                  item.highlight &&
                  !active &&
                  "text-[hsl(var(--accent))]/90",
              )}
            >
              {item.label}
            </Link>
          );
        })}
        <Link
          href="/settings"
          className={cn(
            "rounded-md px-3 py-2 text-sm transition-colors hover:bg-white/5",
            pathname.startsWith("/settings")
              ? "border-l-2 border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/15 pl-[10px] font-semibold text-white"
              : "text-white/70",
          )}
        >
          Settings
        </Link>
        {role === "ADMIN" ? (
          <Link
            href="/admin/users"
            className={cn(
              "rounded-md px-3 py-2 text-sm transition-colors hover:bg-white/5",
              pathname.startsWith("/admin/users")
                ? "border-l-2 border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/15 pl-[10px] font-semibold text-white"
                : "text-white/70",
            )}
          >
            Users
          </Link>
        ) : null}
      </nav>
      <div className="border-t border-[hsl(var(--border))] p-3">
        <button
          type="button"
          className="w-full rounded-md px-3 py-2 text-left text-sm text-white/70 hover:bg-white/10"
          onClick={() => {
            void logoutSession().then(() => router.push("/login"));
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
