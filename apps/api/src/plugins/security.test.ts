import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authRateLimitMax,
  enrollRateLimit,
  globalRateLimitMax,
} from "./security.js";

const ENV_KEYS = [
  "NODE_ENV",
  "RATE_LIMIT_MAX_PER_MINUTE",
  "AUTH_LOGIN_RATE_MAX",
  "ENROLL_RATE_MAX",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("rate limit defaults", () => {
  it("uses tightened production defaults matching SECURITY-IMPROVEMENTS.md intent", () => {
    process.env.NODE_ENV = "production";
    expect(globalRateLimitMax()).toBe(120);
    expect(authRateLimitMax()).toBe(5);
    expect(enrollRateLimit()).toEqual({ max: 10, timeWindow: "1 hour" });
  });

  it("keeps looser defaults outside production", () => {
    process.env.NODE_ENV = "development";
    expect(globalRateLimitMax()).toBe(1200);
    expect(authRateLimitMax()).toBe(120);
    expect(enrollRateLimit()).toEqual({ max: 60, timeWindow: "15 minutes" });
  });

  it("env var overrides win regardless of NODE_ENV", () => {
    process.env.NODE_ENV = "production";
    process.env.RATE_LIMIT_MAX_PER_MINUTE = "42";
    process.env.AUTH_LOGIN_RATE_MAX = "7";
    process.env.ENROLL_RATE_MAX = "3";
    expect(globalRateLimitMax()).toBe(42);
    expect(authRateLimitMax()).toBe(7);
    expect(enrollRateLimit().max).toBe(3);
  });
});
