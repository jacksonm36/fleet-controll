/** Normalized slug for a specific Linux distribution (within a family). */
export type LinuxDistroSlug =
  | "almalinux"
  | "rocky"
  | "rhel"
  | "centos"
  | "centos_stream"
  | "oracle"
  | "amazon"
  | "cloudlinux"
  | "virtuozzo"
  | "scientific"
  | "eurolinux"
  | "mirantis"
  | "photon"
  | "openeuler"
  | "anolis"
  | "tencentos"
  | "clearos"
  | "springdale"
  | "mariner"
  | "azurelinux"
  | "fedora"
  | "arch"
  | "manjaro"
  | "endeavouros"
  | "garuda"
  | "cachyos"
  | "arcolinux"
  | "artix"
  | "parabola"
  | "hyperbola"
  | "blackarch"
  | "archarm"
  | "rebornos"
  | "kaos"
  | "crystal";

export const RHEL_FAMILY_DISTROS: ReadonlySet<LinuxDistroSlug> = new Set([
  "almalinux",
  "rocky",
  "rhel",
  "centos",
  "centos_stream",
  "oracle",
  "amazon",
  "cloudlinux",
  "virtuozzo",
  "scientific",
  "eurolinux",
  "mirantis",
  "photon",
  "openeuler",
  "anolis",
  "tencentos",
  "clearos",
  "springdale",
  "mariner",
  "azurelinux",
]);

export const ARCH_FAMILY_DISTROS: ReadonlySet<LinuxDistroSlug> = new Set([
  "arch",
  "manjaro",
  "endeavouros",
  "garuda",
  "cachyos",
  "arcolinux",
  "artix",
  "parabola",
  "hyperbola",
  "blackarch",
  "archarm",
  "rebornos",
  "kaos",
  "crystal",
]);

type DistroVars = {
  id?: string | null;
  idLike?: string | null;
  name?: string | null;
  variantId?: string | null;
};

const ID_TO_DISTRO: Record<string, LinuxDistroSlug> = {
  almalinux: "almalinux",
  rocky: "rocky",
  rhel: "rhel",
  ol: "oracle",
  oraclelinux: "oracle",
  amzn: "amazon",
  amazonlinux: "amazon",
  fedora: "fedora",
  cloudlinux: "cloudlinux",
  virtuozzo: "virtuozzo",
  sl: "scientific",
  scientific: "scientific",
  scientificlinux: "scientific",
  eurolinux: "eurolinux",
  openeuler: "openeuler",
  anolis: "anolis",
  alinux: "anolis",
  tencentos: "tencentos",
  clearos: "clearos",
  photon: "photon",
  mariner: "mariner",
  "cbl-mariner": "mariner",
  azurelinux: "azurelinux",
  mirantis: "mirantis",
  springdalelinux: "springdale",
  arch: "arch",
  archlinux: "arch",
  manjaro: "manjaro",
  endeavouros: "endeavouros",
  garuda: "garuda",
  cachyos: "cachyos",
  arcolinux: "arcolinux",
  artix: "artix",
  artixlinux: "artix",
  parabola: "parabola",
  hyperbola: "hyperbola",
  blackarch: "blackarch",
  archarm: "archarm",
  archlinuxarm: "archarm",
  rebornos: "rebornos",
  kaos: "kaos",
  crystal: "crystal",
};

const BLOB_RULES: ReadonlyArray<{ re: RegExp; slug: LinuxDistroSlug }> = [
  { re: /\balmalinux\b|\balma-linux\b/, slug: "almalinux" },
  { re: /\brocky\b|\brockylinux\b/, slug: "rocky" },
  { re: /\b(red\s*hat|redhat)\b|\brhel\b/, slug: "rhel" },
  { re: /\bcentos\s*stream\b|\bcentos_stream\b/, slug: "centos_stream" },
  { re: /\bcentos\b/, slug: "centos" },
  { re: /\boracle\b|\boraclelinux\b|\bol\b/, slug: "oracle" },
  { re: /\bamazon\b|\bamzn\b|\bamazonlinux\b/, slug: "amazon" },
  { re: /\bcloudlinux\b/, slug: "cloudlinux" },
  { re: /\bvirtuozzo\b/, slug: "virtuozzo" },
  { re: /\bscientific\b|\bscientificlinux\b|\bsl\b/, slug: "scientific" },
  { re: /\beurolinux\b/, slug: "eurolinux" },
  { re: /\bmirantis\b/, slug: "mirantis" },
  { re: /\bvmware\s*photon\b|\bphoton\b/, slug: "photon" },
  { re: /\bopeneuler\b/, slug: "openeuler" },
  { re: /\banolis\b|\balinux\b/, slug: "anolis" },
  { re: /\btencentos\b/, slug: "tencentos" },
  { re: /\bclearos\b/, slug: "clearos" },
  { re: /\bspringdale\b/, slug: "springdale" },
  { re: /\bazure\s*linux\b|\bazurelinux\b|\bcbl-mariner\b|\bmariner\b/, slug: "mariner" },
  { re: /\bfedora\b/, slug: "fedora" },
  { re: /\bmanjaro\b/, slug: "manjaro" },
  { re: /\bendeavour\s*os\b|\bendeavouros\b/, slug: "endeavouros" },
  { re: /\bgaruda\b/, slug: "garuda" },
  { re: /\bcachyos\b|\bcachy\s*os\b/, slug: "cachyos" },
  { re: /\barcolinux\b|\barco-?linux\b/, slug: "arcolinux" },
  { re: /\bartix\s*linux\b|\bartix\b/, slug: "artix" },
  { re: /\bparabola\b/, slug: "parabola" },
  { re: /\bhyperbola\b/, slug: "hyperbola" },
  { re: /\bblackarch\b/, slug: "blackarch" },
  { re: /\barch\s*linux\s*arm\b|\barchlinuxarm\b|\barcharm\b/, slug: "archarm" },
  { re: /\breborn\s*os\b|\brebornos\b/, slug: "rebornos" },
  { re: /\bkaos\b/, slug: "kaos" },
  { re: /\bcrystal\b/, slug: "crystal" },
  { re: /\barchlinux\b/, slug: "arch" },
];

const ARCH_ID_LIKE_RE = /\b(arch|archlinux)\b/;

export function resolveLinuxDistro(vars: DistroVars): LinuxDistroSlug | null {
  const id = (vars.id ?? "").trim().toLowerCase();
  const variant = (vars.variantId ?? "").trim().toLowerCase();

  if (id === "centos") {
    return variant === "stream" ? "centos_stream" : "centos";
  }
  if (id && ID_TO_DISTRO[id]) {
    return ID_TO_DISTRO[id]!;
  }

  const blob = `${id} ${vars.idLike ?? ""} ${vars.name ?? ""}`.toLowerCase();
  for (const { re, slug } of BLOB_RULES) {
    if (re.test(blob)) return slug;
  }
  if (id === "arch" || ARCH_ID_LIKE_RE.test(vars.idLike ?? "")) {
    return "arch";
  }
  return null;
}

export function isArchFamilyDistro(
  distro: LinuxDistroSlug | null | undefined,
): boolean {
  return !!distro && ARCH_FAMILY_DISTROS.has(distro);
}

export function isRhelFamilyDistro(
  distro: LinuxDistroSlug | null | undefined,
): boolean {
  return !!distro && RHEL_FAMILY_DISTROS.has(distro);
}

export function osDistroLabel(
  distro: LinuxDistroSlug | null | undefined,
  family: string,
  name?: string | null,
): string {
  switch (distro) {
    case "almalinux":
      return "AlmaLinux";
    case "rocky":
      return "Rocky";
    case "rhel":
      return "RHEL";
    case "centos":
      return "CentOS";
    case "centos_stream":
      return "CentOS Stream";
    case "oracle":
      return "Oracle Linux";
    case "amazon":
      return "Amazon Linux";
    case "cloudlinux":
      return "CloudLinux";
    case "virtuozzo":
      return "Virtuozzo";
    case "scientific":
      return "Scientific Linux";
    case "eurolinux":
      return "EuroLinux";
    case "mirantis":
      return "Mirantis";
    case "photon":
      return "Photon OS";
    case "openeuler":
      return "openEuler";
    case "anolis":
      return "Anolis OS";
    case "tencentos":
      return "TencentOS";
    case "clearos":
      return "ClearOS";
    case "springdale":
      return "Springdale";
    case "mariner":
      return "Azure Linux";
    case "azurelinux":
      return "Azure Linux";
    case "fedora":
      return "Fedora";
    case "arch":
      return "Arch Linux";
    case "manjaro":
      return "Manjaro";
    case "endeavouros":
      return "EndeavourOS";
    case "garuda":
      return "Garuda";
    case "cachyos":
      return "CachyOS";
    case "arcolinux":
      return "ArcoLinux";
    case "artix":
      return "Artix";
    case "parabola":
      return "Parabola";
    case "hyperbola":
      return "Hyperbola";
    case "blackarch":
      return "BlackArch";
    case "archarm":
      return "Arch Linux ARM";
    case "rebornos":
      return "RebornOS";
    case "kaos":
      return "KaOS";
    case "crystal":
      return "Crystal";
    default:
      break;
  }
  if (name?.trim()) return name.trim();
  if (family === "rhel") return "RHEL family";
  if (family === "arch") return "Arch Linux";
  return "Linux";
}

/** Badge text: prefer specific distro over generic family label. */
export function osBadgeLabel(
  family: string,
  distro: LinuxDistroSlug | null | undefined,
  name?: string | null,
  familyLabelFn?: (f: string) => string, // eslint-disable-line @typescript-eslint/no-explicit-any
): string {
  const familyLabel =
    familyLabelFn ??
    ((f: string) => {
      switch (f) {
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
    });

  if (distro) {
    const label = osDistroLabel(distro, family, name);
    if (label !== "Linux") return label;
  }
  return familyLabel(family);
}

/** EL major from PLATFORM_ID (e.g. platform:el9.8 → EL9). */
export function rhelPlatformLabel(platformId: string | null | undefined): string | null {
  if (!platformId) return null;
  const m = platformId.match(/(?:^|:)el(\d+(?:\.\d+)?)/i);
  if (!m?.[1]) return null;
  return `EL${m[1]!.split(".")[0]}`;
}

const RPM_MANAGERS = new Set(["rpm", "dnf", "yum"]);
const PACMAN_MANAGERS = new Set(["pacman"]);
const APK_MANAGERS = new Set(["apk"]);
const ZYPPER_MANAGERS = new Set(["zypper"]);

/** OSV ecosystem string for vulnerability matching. */
export function osvEcosystem(
  osType: string,
  osDetail: string | null | undefined,
  manager: string,
  parsed?: {
    distro: LinuxDistroSlug | null;
    family: string;
    versionId: string | null;
    id: string | null;
  } | null,
): string | null {
  const m = manager.toLowerCase();
  const supported =
    RPM_MANAGERS.has(m) ||
    PACMAN_MANAGERS.has(m) ||
    APK_MANAGERS.has(m) ||
    ZYPPER_MANAGERS.has(m) ||
    m === "dpkg" ||
    m === "apt" ||
    m === "emerge";
  if (!supported && osType === "darwin" && m === "brew") {
    return null;
  }
  if (!supported) return null;
  if (osType !== "linux" && !(osType === "darwin" && m === "brew")) return null;

  const ver = parsed?.versionId?.split(".")[0] ?? "";
  const distro = parsed?.distro ?? null;

  if (PACMAN_MANAGERS.has(m) || isArchFamilyDistro(distro) || parsed?.family === "arch") {
    return "Arch Linux";
  }

  if (APK_MANAGERS.has(m) || parsed?.family === "alpine") {
    return ver ? `Alpine:${ver}` : null;
  }

  if (ZYPPER_MANAGERS.has(m) || parsed?.family === "suse") {
    return ver ? `openSUSE:${ver}` : "openSUSE:15.5";
  }

  if (m === "dpkg" || m === "apt") {
    const id = (parsed?.id ?? "").toLowerCase();
    if (id.includes("debian") || m === "dpkg") {
      return ver ? `Debian:${ver}` : "Debian:12";
    }
    if (id.includes("ubuntu")) {
      return ver ? `Ubuntu:${ver}` : "Ubuntu:22.04";
    }
  }

  if (distro === "fedora" || parsed?.family === "fedora") {
    return ver ? `Fedora:${ver}` : null;
  }

  if (isRhelFamilyDistro(distro) || parsed?.family === "rhel") {
    return ver ? `Red Hat:${ver}` : "Red Hat:9";
  }

  if (RPM_MANAGERS.has(m) && ver) {
    return `Red Hat:${ver}`;
  }
  return null;
}
