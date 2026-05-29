export type ParsedOs = {
  prettyName: string | null;
  name: string | null;
  versionId: string | null;
  version: string | null;
  codename: string | null;
  id: string | null;
  debianVersionFull: string | null;
  homeUrl: string | null;
};

/** Parse raw /etc/os-release text (newline or space separated). */
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

export function parseOsDetail(
  osType: string,
  osDetail: string | null | undefined,
): ParsedOs | null {
  if (!osDetail?.trim()) return null;

  if (/^(NAME|PRETTY_NAME|ID)=/m.test(osDetail)) {
    const vars = parseOsRelease(osDetail);
    return {
      prettyName: vars.PRETTY_NAME ?? vars.NAME ?? null,
      name: vars.NAME ?? null,
      versionId: vars.VERSION_ID ?? null,
      version: vars.VERSION ?? null,
      codename: vars.VERSION_CODENAME ?? null,
      id: vars.ID ?? null,
      debianVersionFull: vars.DEBIAN_VERSION_FULL ?? null,
      homeUrl: vars.HOME_URL ?? null,
    };
  }

  return {
    prettyName: osDetail.trim(),
    name: osType,
    versionId: null,
    version: null,
    codename: null,
    id: null,
    debianVersionFull: null,
    homeUrl: null,
  };
}

/** One-line label for headers and compact lists. */
export function osSummaryLine(
  osType: string,
  osDetail: string | null | undefined,
): string {
  const parsed = parseOsDetail(osType, osDetail);
  if (!parsed) return osType.charAt(0).toUpperCase() + osType.slice(1);
  if (parsed.prettyName) return parsed.prettyName;
  if (parsed.name && parsed.versionId) return `${parsed.name} ${parsed.versionId}`;
  return osType.charAt(0).toUpperCase() + osType.slice(1);
}

export function osDisplayTitle(parsed: ParsedOs, osType: string): string {
  if (parsed.prettyName) return parsed.prettyName;
  if (parsed.name && parsed.versionId) return `${parsed.name} ${parsed.versionId}`;
  return osType.charAt(0).toUpperCase() + osType.slice(1);
}
