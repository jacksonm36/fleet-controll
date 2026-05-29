import crypto from "node:crypto";

import argon2 from "argon2";
import bcrypt from "bcryptjs";

const ARGON2_TOKEN_OPTS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const ARGON2_PASSWORD_OPTS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
};

function pepperSalt(): Buffer {
  const pepper =
    process.env.TOKEN_PEPPER?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    "fleet-dev-pepper-change-me";
  return crypto.createHash("sha256").update(pepper, "utf8").digest();
}

/** Legacy SHA-256 hex (pre-argon2 API/enrollment tokens). */
export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function isLegacySha256Hash(stored: string): boolean {
  return /^[a-f0-9]{64}$/i.test(stored);
}

export function isBcryptHash(stored: string): boolean {
  return stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$");
}

/** Admin / user passwords — random salt per hash. */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_PASSWORD_OPTS);
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  if (stored.startsWith("$argon2")) {
    try {
      return await argon2.verify(stored, plain);
    } catch {
      return false;
    }
  }
  if (isBcryptHash(stored)) {
    return bcrypt.compare(plain, stored);
  }
  return false;
}

/**
 * High-entropy tokens (enrollment, agent API keys) — deterministic Argon2id
 * using server pepper so we can index/lookup by hash in Postgres.
 */
export async function hashToken(plain: string): Promise<string> {
  return argon2.hash(plain, { ...ARGON2_TOKEN_OPTS, salt: pepperSalt() });
}

export async function verifyToken(
  plain: string,
  stored: string,
): Promise<boolean> {
  if (stored.startsWith("$argon2")) {
    try {
      return await argon2.verify(stored, plain);
    } catch {
      return false;
    }
  }
  if (isLegacySha256Hash(stored)) {
    return sha256Hex(plain) === stored;
  }
  return false;
}

export function randomAgentToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function randomEnrollmentToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function secretKey(): Buffer {
  const raw =
    process.env.TOTP_ENCRYPTION_KEY?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    "fleet-dev-pepper-change-me";
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

/** Encrypt small secrets (TOTP seed) for storage at rest. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptSecret(stored: string): string {
  const buf = Buffer.from(stored, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function randomRecoveryCode(): string {
  return crypto.randomBytes(5).toString("hex").slice(0, 10).toUpperCase();
}
