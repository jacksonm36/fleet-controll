import crypto from "node:crypto";

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function randomAgentToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function randomEnrollmentToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}
