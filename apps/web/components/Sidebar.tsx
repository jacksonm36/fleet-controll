"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@fleet/ui";

const nav = [
  { href: "/", label: "Fleet" },
  { href: "/agents", label: "Agents" },
  { href: "/crowdsec", label: "CrowdSec" },
  { href: "/enrollment", label: "Enrollment" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex h-screen w-56 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <div className="border-b border-[hsl(var(--border))] px-4 py-4">
        <div className="text-sm font-semibold tracking-wide text-[hsl(var(--accent))]">
          Fleet Control
        </div>
        <div className="text-xs text-[hsl(var(--muted))]">Patch · systemd · CrowdSec</div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm transition-colors hover:bg-white/5",
              pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href))
                ? "bg-white/10 font-medium"
                : "text-white/70",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
