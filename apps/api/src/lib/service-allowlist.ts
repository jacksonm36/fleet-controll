/** Restrict with e.g. fleet-agent\\.service|nginx\\.service — default allows all (lab). */
const raw = process.env.SERVICE_ALLOWLIST ?? ".*";

let serviceAllowlistRegex: RegExp;
try {
  serviceAllowlistRegex = new RegExp(`^${raw}$`);
} catch {
  serviceAllowlistRegex = /^.*$/;
}

export function isServiceActionAllowed(name: string): boolean {
  return serviceAllowlistRegex.test(name);
}
