"use client";

export type MonitoringTab =
  | "overview"
  | "metrics"
  | "logs"
  | "activity"
  | "security";

const TABS: { id: MonitoringTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "metrics", label: "Metrics" },
  { id: "logs", label: "Logs" },
  { id: "activity", label: "Activity" },
  { id: "security", label: "Security" },
];

export function AgentMonitoringTabs({
  active,
  onChange,
  badges,
}: {
  active: MonitoringTab;
  onChange: (tab: MonitoringTab) => void;
  badges?: Partial<Record<MonitoringTab, number>>;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-white/10 pb-0">
      {TABS.map((t) => {
        const count = badges?.[t.id];
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`relative rounded-t-md px-4 py-2.5 text-sm font-medium transition ${
              active === t.id
                ? "bg-[hsl(var(--card))] text-[hsl(var(--accent))] shadow-[inset_0_-2px_0_0_hsl(var(--accent))]"
                : "text-white/50 hover:bg-white/5 hover:text-white/80"
            }`}
          >
            {t.label}
            {count != null && count > 0 ? (
              <span className="ml-1.5 rounded-full bg-red-500/25 px-1.5 py-0.5 text-[10px] text-red-300">
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
