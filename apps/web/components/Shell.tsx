"use client";

import { Sidebar } from "@/components/Sidebar";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-[hsl(var(--background))] p-6">
        {children}
      </main>
    </div>
  );
}
