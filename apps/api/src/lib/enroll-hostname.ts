/** Matches fleet-agent `enrollHostnameFlag` (short hostname, sanitized). */
export function normalizeEnrollHostname(raw: string): string {
  let h = raw.trim();
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (!h) return "fleet-host";

  const dot = h.indexOf(".");
  if (dot > 0) {
    const short = h.slice(0, dot);
    if (short) h = short;
  }

  if (h.length > 128) h = h.slice(0, 128);

  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(h)) return h;

  let cleaned = "";
  for (const ch of h) {
    if (/[A-Za-z0-9._-]/.test(ch)) cleaned += ch;
    else cleaned += "-";
  }
  cleaned = cleaned.replace(/^[-._]+|[-._]+$/g, "");
  if (!cleaned || !/^[A-Za-z0-9]/.test(cleaned)) {
    cleaned = `fleet-host-${cleaned}`.replace(/^[-._]+/, "");
  }
  if (cleaned.length > 128) cleaned = cleaned.slice(0, 128);
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(cleaned)) return cleaned;
  return "fleet-host";
}

/** Unique Fleet row name for templated VMs (never use raw template hostname alone). */
export function defaultFleetHostnameFromIp(
  machineHostname: string,
  enrollIp: string | null,
): string {
  if (enrollIp) {
    const last = enrollIp.split(".").pop()?.replace(/\D/g, "") ?? "";
    if (last) {
      const candidate = `${machineHostname}-${last}`;
      if (candidate.length <= 128) return candidate;
    }
  }
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${machineHostname}-${suffix}`.slice(0, 128);
}
