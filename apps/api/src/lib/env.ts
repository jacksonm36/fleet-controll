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
