export type OsPlatform = "linux" | "windows" | "darwin" | "freebsd" | "openbsd" | "netbsd";

export type OsFamily =
  | "debian"
  | "ubuntu"
  | "rhel"
  | "fedora"
  | "arch"
  | "alpine"
  | "suse"
  | "gentoo"
  | "nixos"
  | "windows"
  | "macos"
  | "freebsd"
  | "bsd"
  | "linux-other"
  | "unknown";

import {
  osDistroLabel,
  osvEcosystem,
  resolveLinuxDistro,
  rhelPlatformLabel,
  type LinuxDistroSlug,
} from "./linux-distros.js";

export type { LinuxDistroSlug };
export {
  ARCH_FAMILY_DISTROS,
  RHEL_FAMILY_DISTROS,
  isArchFamilyDistro,
  isRhelFamilyDistro,
  osBadgeLabel,
  osDistroLabel,
  osvEcosystem,
  resolveLinuxDistro,
  rhelPlatformLabel,
} from "./linux-distros.js";
// osBadgeLabel kept for advanced callers

export type ParsedOs = {
  prettyName: string | null;
  name: string | null;
  versionId: string | null;
  version: string | null;
  codename: string | null;
  id: string | null;
  idLike: string | null;
  variantId: string | null;
  platformId: string | null;
  distro: LinuxDistroSlug | null;
  debianVersionFull: string | null;
  homeUrl: string | null;
  build: string | null;
  family: OsFamily;
  platform: OsPlatform | string;
};

export const OS_PLATFORMS: readonly OsPlatform[] = [
  "linux",
  "windows",
  "darwin",
  "freebsd",
  "openbsd",
  "netbsd",
];

/** Parse os-release / agent-normalized KEY=value blocks. */
export function parseOsRelease(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re =
    /([A-Z0-9_]+)=("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    let val = match[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[match[1]] = val;
  }
  return out;
}

function normalizePlatform(osType: string): OsPlatform | string {
  const t = osType.trim().toLowerCase();
  if (OS_PLATFORMS.includes(t as OsPlatform)) return t as OsPlatform;
  return t || "unknown";
}

function detectLinuxFamily(id: string, idLike: string): OsFamily {
  const blob = `${id} ${idLike}`.toLowerCase();
  if (/\b(ubuntu|pop|mint|elementary|zorin|kubuntu|xubuntu|lubuntu)\b/.test(blob)) {
    return "ubuntu";
  }
  if (/\b(debian|raspbian|devuan)\b/.test(blob)) return "debian";
  if (
    /\b(rhel|centos|rocky|alma|almalinux|oracle|ol|amzn|amazon|cloudlinux|virtuozzo|scientific|eurolinux|mirantis|photon|openeuler|anolis|tencentos|clearos|springdale|mariner|cbl-mariner|azurelinux)\b/.test(
      blob,
    )
  ) {
    return "rhel";
  }
  if (/\b(fedora|nobara|ultramarine)\b/.test(blob)) return "fedora";
  if (
    /\b(archlinux|manjaro|endeavouros|endeavour|garuda|cachyos|cachy|arcolinux|arco|artix|parabola|hyperbola|blackarch|archarm|archlinuxarm|rebornos|reborn|kaos|crystal)\b/.test(
      blob,
    ) ||
    /\barch\b/.test(id) ||
    /\b(arch|archlinux)\b/.test(idLike)
  ) {
    return "arch";
  }
  if (/\b(alpine|postmarketos)\b/.test(blob)) return "alpine";
  if (/\b(opensuse|suse|sles|sle)\b/.test(blob)) return "suse";
  if (/\b(gentoo|funtoo|calculate)\b/.test(blob)) return "gentoo";
  if (/\b(nixos|nix)\b/.test(blob)) return "nixos";
  if (id || idLike) return "linux-other";
  return "linux-other";
}

export function detectOsFamily(
  osType: string,
  parsed: Pick<ParsedOs, "id" | "name"> & { idLike?: string | null },
): OsFamily {
  const platform = normalizePlatform(osType);
  if (platform === "windows") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "freebsd") return "freebsd";
  if (platform === "openbsd" || platform === "netbsd") return "bsd";

  const id = (parsed.id ?? parsed.name ?? "").toLowerCase();
  const idLike = (parsed.idLike ?? "").toLowerCase();
  return detectLinuxFamily(id, idLike);
}

export function parseOsDetail(
  osType: string,
  osDetail: string | null | undefined,
): ParsedOs | null {
  const platform = normalizePlatform(osType);
  if (!osDetail?.trim()) {
    return {
      prettyName: null,
      name: null,
      versionId: null,
      version: null,
      codename: null,
      id: null,
      idLike: null,
      variantId: null,
      platformId: null,
      distro: null,
      debianVersionFull: null,
      homeUrl: null,
      build: null,
      family:
        platform === "windows"
          ? "windows"
          : platform === "darwin"
            ? "macos"
            : platform === "freebsd"
              ? "freebsd"
              : "unknown",
      platform,
    };
  }

  if (/^(NAME|PRETTY_NAME|ID)=/m.test(osDetail)) {
    const vars = parseOsRelease(osDetail);
    const idLike = vars.ID_LIKE ?? "";
    const variantId = vars.VARIANT_ID ?? null;
    const platformId = vars.PLATFORM_ID ?? null;
    const base = {
      prettyName: vars.PRETTY_NAME ?? vars.NAME ?? null,
      name: vars.NAME ?? null,
      versionId: vars.VERSION_ID ?? null,
      version: vars.VERSION ?? null,
      codename: vars.VERSION_CODENAME ?? variantId,
      id: vars.ID ?? null,
      idLike: idLike || null,
      variantId,
      platformId,
      distro: null as LinuxDistroSlug | null,
      debianVersionFull: vars.DEBIAN_VERSION_FULL ?? null,
      homeUrl: vars.HOME_URL ?? null,
      build: vars.BUILD ?? null,
      platform,
    };
    const family =
      platform === "linux"
        ? detectLinuxFamily(base.id ?? "", idLike)
        : detectOsFamily(osType, { ...base, idLike });
    const distro =
      platform === "linux"
        ? resolveLinuxDistro({
            id: base.id,
            idLike,
            name: base.name,
            variantId,
          })
        : null;
    return { ...base, family, distro };
  }

  const family = detectOsFamily(osType, { id: osType, name: osType });
  return {
    prettyName: osDetail.trim(),
    name: osType,
    versionId: null,
    version: null,
    codename: null,
    id: null,
    idLike: null,
    variantId: null,
    platformId: null,
    distro: null,
    debianVersionFull: null,
    homeUrl: null,
    build: null,
    family,
    platform,
  };
}

/** Primary UI badge: AlmaLinux, Rocky, Debian, … */
export function osPrimaryBadgeLabel(parsed: ParsedOs): string {
  if (parsed.distro) {
    const label = osDistroLabel(parsed.distro, parsed.family, parsed.name);
    if (label !== "Linux") return label;
  }
  return osFamilyLabel(parsed.family);
}

export function osFamilyLabel(family: OsFamily): string {
  switch (family) {
    case "debian":
      return "Debian";
    case "ubuntu":
      return "Ubuntu";
    case "rhel":
      return "RHEL family";
    case "fedora":
      return "Fedora";
    case "arch":
      return "Arch";
    case "alpine":
      return "Alpine";
    case "suse":
      return "SUSE";
    case "gentoo":
      return "Gentoo";
    case "nixos":
      return "NixOS";
    case "windows":
      return "Windows";
    case "macos":
      return "macOS";
    case "freebsd":
      return "FreeBSD";
    case "bsd":
      return "BSD";
    case "linux-other":
      return "Linux";
    default:
      return "Unknown";
  }
}

export function osDisplayTitle(parsed: ParsedOs, osType: string): string {
  if (parsed.prettyName) return parsed.prettyName;
  if (parsed.name && parsed.versionId) {
    return `${parsed.name} ${parsed.versionId}`;
  }
  const label = osFamilyLabel(parsed.family);
  if (label !== "Unknown" && label !== "Linux") return label;
  const p = normalizePlatform(osType);
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export function osSummaryLine(
  osType: string,
  osDetail: string | null | undefined,
): string {
  const parsed = parseOsDetail(osType, osDetail);
  if (!parsed) return osType.charAt(0).toUpperCase() + osType.slice(1);
  return osDisplayTitle(parsed, osType);
}
