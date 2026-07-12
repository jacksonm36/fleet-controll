import { describe, expect, it } from "vitest";
import { passwordMinLength, validateNewPassword } from "./password-policy.js";

describe("validateNewPassword", () => {
  it("rejects passwords shorter than the minimum length", () => {
    expect(validateNewPassword("Ab1")).toBe(
      `Password must be at least ${passwordMinLength()} characters`,
    );
  });

  it("rejects passwords longer than 256 characters", () => {
    const tooLong = "Aa1" + "x".repeat(300);
    expect(validateNewPassword(tooLong)).toBe("Password is too long");
  });

  it("rejects common passwords regardless of case", () => {
    expect(validateNewPassword("Administrator")).toBe(
      "Password is too common — choose a stronger one",
    );
  });

  it("rejects passwords missing a letter", () => {
    expect(validateNewPassword("123456789012")).toBe(
      "Password must include at least one letter and one number",
    );
  });

  it("rejects passwords missing a digit", () => {
    expect(validateNewPassword("abcdefghijkl")).toBe(
      "Password must include at least one letter and one number",
    );
  });

  it("rejects an empty password", () => {
    expect(validateNewPassword("")).toBe(
      `Password must be at least ${passwordMinLength()} characters`,
    );
  });

  it("accepts a password meeting all requirements", () => {
    expect(validateNewPassword("Correct-Horse-9")).toBeNull();
  });
});
