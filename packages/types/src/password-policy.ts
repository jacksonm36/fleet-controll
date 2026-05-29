function readMinLengthEnv(): number | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const raw =
    process.env.PASSWORD_MIN_LENGTH ??
    process.env.NEXT_PUBLIC_PASSWORD_MIN_LENGTH;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 8 ? Math.floor(n) : undefined;
}

/** Minimum password length (override with PASSWORD_MIN_LENGTH or NEXT_PUBLIC_PASSWORD_MIN_LENGTH). */
export function passwordMinLength(): number {
  return readMinLengthEnv() ?? 12;
}

const COMMON_PASSWORDS = new Set(
  [
    "password",
    "password1",
    "password123",
    "changeme",
    "changeme123",
    "admin",
    "administrator",
    "123456",
    "12345678",
    "123456789",
    "qwerty",
    "letmein",
    "welcome",
    "fleet",
    "fleet123",
  ].map((s) => s.toLowerCase()),
);

export function validateNewPassword(password: string): string | null {
  const min = passwordMinLength();
  if (!password || password.length < min) {
    return `Password must be at least ${min} characters`;
  }
  if (password.length > 256) {
    return "Password is too long";
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return "Password is too common — choose a stronger one";
  }
  const hasLetter = /[A-Za-z]/.test(password);
  const hasDigit = /\d/.test(password);
  if (!hasLetter || !hasDigit) {
    return "Password must include at least one letter and one number";
  }
  return null;
}

export function passwordPolicyHint(): string {
  return `At least ${passwordMinLength()} characters, with letters and numbers (not a common password)`;
}
