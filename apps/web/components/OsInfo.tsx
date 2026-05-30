import type { ReactNode } from "react";
import {
  osDisplayTitle,
  osPrimaryBadgeLabel,
  parseOsDetail,
  rhelPlatformLabel,
  type OsFamily,
} from "@/lib/os-display";

type OsInfoProps = {
  osType: string;
  osDetail: string | null | undefined;
  /** compact = single line with optional badge; card = title + pill row */
  variant?: "compact" | "card";
};

function familyTone(family: OsFamily): "neutral" | "accent" | "muted" | "windows" | "macos" | "freebsd" {
  switch (family) {
    case "windows":
      return "windows";
    case "macos":
      return "macos";
    case "freebsd":
    case "bsd":
      return "freebsd";
    case "ubuntu":
    case "debian":
    case "rhel":
    case "fedora":
    case "arch":
    case "alpine":
    case "suse":
      return "accent";
    default:
      return "muted";
  }
}

function OsBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "muted" | "windows" | "macos" | "freebsd";
}) {
  const tones = {
    neutral: "bg-white/10 text-white/70",
    accent: "bg-[hsl(var(--accent))]/15 text-[hsl(var(--accent))]",
    muted: "bg-white/5 text-white/45",
    windows: "bg-sky-500/15 text-sky-300",
    macos: "bg-zinc-500/20 text-zinc-200",
    freebsd: "bg-red-500/15 text-red-300",
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
  const badgeLabel = osPrimaryBadgeLabel(parsed);
  const familyBadgeTone = familyTone(parsed.family);
  const elLabel =
    parsed.family === "rhel" ? rhelPlatformLabel(parsed.platformId) : null;

  if (variant === "compact") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="text-white/80">{title}</span>
        <OsBadge tone={familyBadgeTone}>{badgeLabel}</OsBadge>
        {elLabel ? <OsBadge tone="muted">{elLabel}</OsBadge> : null}
        {parsed.codename &&
        (parsed.family === "debian" || parsed.family === "ubuntu") ? (
          <OsBadge tone="muted">{parsed.codename}</OsBadge>
        ) : null}
      </span>
    );
  }

  const pills: { label: string; tone: "neutral" | "accent" | "muted" | "windows" | "macos" | "freebsd" }[] = [
    { label: badgeLabel, tone: familyBadgeTone },
  ];
  if (parsed.versionId) {
    pills.push({ label: `v${parsed.versionId}`, tone: "accent" });
  }
  if (elLabel) {
    pills.push({ label: elLabel, tone: "muted" });
  }
  if (parsed.codename) {
    pills.push({ label: parsed.codename, tone: "muted" });
  }
  if (parsed.debianVersionFull) {
    pills.push({ label: `Debian ${parsed.debianVersionFull}`, tone: "muted" });
  }
  if (parsed.build && parsed.family === "windows") {
    pills.push({ label: `build ${parsed.build}`, tone: "muted" });
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
