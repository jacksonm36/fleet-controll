const DEV_JWT_PLACEHOLDER = "dev-change-me-use-32-plus-characters-secret";

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 32) {
    if (isProduction()) {
      throw new Error(
        "JWT_SECRET must be set to at least 32 characters in production (npm run env:generate)",
      );
    }
    return secret && secret.length > 0 ? secret : DEV_JWT_PLACEHOLDER;
  }
  if (isProduction() && secret === DEV_JWT_PLACEHOLDER) {
    throw new Error("JWT_SECRET must not use the development default in production");
  }
  return secret;
}

export function resolveCorsOrigins(): boolean | string[] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (raw) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (isProduction()) {
    return ["http://127.0.0.1:3000", "http://localhost:3000"];
  }
  return true;
}

export function resolveTrustProxy(): boolean {
  return process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true";
}

/** Install/enroll scripts and agent API default to HTTPS (disable with FLEET_AUTO_ENCRYPT=0). */
export function fleetAutoEncrypt(): boolean {
  const raw = process.env.FLEET_AUTO_ENCRYPT?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return true;
}

/** When true, all agent API traffic including enroll must use HTTPS. */
export function fleetRequireTls(): boolean {
  const raw = process.env.FLEET_REQUIRE_TLS?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return fleetAutoEncrypt();
}

export function fleetPublicHost(): string | null {
  const h = process.env.FLEET_PUBLIC_HOST?.trim();
  return h || null;
}

export function fleetHstsEnabled(): boolean {
  const raw = process.env.FLEET_HSTS?.trim().toLowerCase();
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return fleetRequireTls();
}

/** When true, Content-Security-Policy is sent in report-only mode (browser devtools). */
export function cspReportOnlyEnabled(): boolean {
  const raw = process.env.CSP_REPORT_ONLY?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
