import { isProduction, resolveJwtSecret } from "./env.js";

const DEV_JWT_PLACEHOLDER = "dev-change-me-use-32-plus-characters-secret";
const DEV_PEPPER_PLACEHOLDER = "fleet-dev-pepper-change-me";

export function shellAutomationDisabled(): boolean {
  const raw = process.env.AUTOMATION_DISABLE_SHELL?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function serviceAllowlistPattern(): string {
  return process.env.SERVICE_ALLOWLIST?.trim() || ".*";
}

export function isPermissiveServiceAllowlist(): boolean {
  const p = serviceAllowlistPattern();
  return p === ".*" || p === "^.*$" || p === "";
}

export function assertProductionSecrets(): void {
  if (!isProduction()) return;

  const pepper =
    process.env.TOKEN_PEPPER?.trim() || process.env.JWT_SECRET?.trim() || "";
  if (!pepper || pepper === DEV_PEPPER_PLACEHOLDER) {
    throw new Error(
      "TOKEN_PEPPER or JWT_SECRET must be set to a strong value in production",
    );
  }

  resolveJwtSecret();
}

export type SecurityCheck = {
  id: string;
  severity: "critical" | "warning" | "info";
  message: string;
};

export function runSecurityChecks(): SecurityCheck[] {
  const checks: SecurityCheck[] = [];

  const jwt = process.env.JWT_SECRET?.trim() ?? "";
  if (!jwt || jwt.length < 32) {
    checks.push({
      id: "jwt_weak",
      severity: "critical",
      message: "JWT_SECRET is missing or shorter than 32 characters",
    });
  } else if (jwt === DEV_JWT_PLACEHOLDER) {
    checks.push({
      id: "jwt_default",
      severity: "critical",
      message: "JWT_SECRET is still the development placeholder",
    });
  }

  const pepper = process.env.TOKEN_PEPPER?.trim() || jwt;
  if (!pepper || pepper === DEV_PEPPER_PLACEHOLDER) {
    checks.push({
      id: "pepper_weak",
      severity: "warning",
      message: "Set TOKEN_PEPPER to a dedicated secret (not the dev default)",
    });
  }

  if (isPermissiveServiceAllowlist()) {
    checks.push({
      id: "service_allowlist_open",
      severity: "warning",
      message:
        'SERVICE_ALLOWLIST is ".*" — any operator can restart any systemd unit',
    });
  }

  if (!isProduction() && process.env.NODE_ENV !== "production") {
    checks.push({
      id: "node_dev",
      severity: "info",
      message: "NODE_ENV is not production",
    });
  }

  if (process.env.FLEET_REQUIRE_TLS !== "1" && process.env.FLEET_REQUIRE_TLS !== "true") {
    checks.push({
      id: "tls_optional",
      severity: "warning",
      message: "FLEET_REQUIRE_TLS is not enabled — agent and UI may use cleartext HTTP",
    });
  }

  if (shellAutomationDisabled()) {
    checks.push({
      id: "shell_disabled",
      severity: "info",
      message: "SHELL_SCRIPT automation jobs are disabled (AUTOMATION_DISABLE_SHELL)",
    });
  }

  return checks;
}
