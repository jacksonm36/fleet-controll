import type { ReactNode } from "react";
import { osDisplayTitle, parseOsDetail } from "@/lib/os-display";

type OsInfoProps = {
  osType: string;
  osDetail: string | null | undefined;
  /** compact = single line with optional badge; card = title + pill row */
  variant?: "compact" | "card";
};

function OsBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "muted";
}) {
  const tones = {
    neutral: "bg-white/10 text-white/70",
    accent: "bg-[hsl(var(--accent))]/15 text-[hsl(var(--accent))]",
    muted: "bg-white/5 text-white/45",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function OsInfo({
  osType,
  osDetail,
  variant = "card",
}: OsInfoProps) {
  const parsed = parseOsDetail(osType, osDetail);
  if (!parsed) {
    return (
      <span className="capitalize text-white/80">
        {osType}
      </span>
    );
  }

  const title = osDisplayTitle(parsed, osType);

  if (variant === "compact") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="text-white/80">{title}</span>
        {parsed.codename ? (
          <OsBadge tone="accent">{parsed.codename}</OsBadge>
        ) : null}
      </span>
    );
  }

  const pills: { label: string; tone: "neutral" | "accent" | "muted" }[] = [
    { label: osType, tone: "neutral" },
  ];
  if (parsed.versionId) {
    pills.push({ label: `v${parsed.versionId}`, tone: "accent" });
  }
  if (parsed.codename) {
    pills.push({ label: parsed.codename, tone: "muted" });
  }
  if (parsed.debianVersionFull) {
    pills.push({ label: `Debian ${parsed.debianVersionFull}`, tone: "muted" });
  }

  return (
    <div className="space-y-1.5">
      <div className="font-medium leading-snug text-white">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {pills.map((pill) => (
          <OsBadge key={pill.label} tone={pill.tone}>
            {pill.label}
          </OsBadge>
        ))}
      </div>
    </div>
  );
}
