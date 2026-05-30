import { describe, expect, it } from "vitest";
import {
  defaultFleetHostnameFromIp,
  normalizeEnrollHostname,
} from "./enroll-hostname.js";

describe("normalizeEnrollHostname", () => {
  it("strips domain suffix like the agent", () => {
    expect(normalizeEnrollHostname("nextcloud.wnas.domain")).toBe("nextcloud");
    expect(normalizeEnrollHostname("mail.example.com")).toBe("mail");
  });
});

describe("defaultFleetHostnameFromIp", () => {
  it("suffixes template name with IP octet", () => {
    expect(defaultFleetHostnameFromIp("debian13univ", "192.168.1.187")).toBe(
      "debian13univ-187",
    );
  });
});
