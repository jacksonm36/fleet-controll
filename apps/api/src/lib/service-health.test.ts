import { describe, expect, it } from "vitest";
import { serviceNeedsAttention } from "./service-health.js";

describe("serviceNeedsAttention", () => {
  it("treats active systemd units as healthy", () => {
    expect(
      serviceNeedsAttention({
        name: "nginx.service",
        kind: "systemd",
        state: "active",
        enabled: true,
      }),
    ).toBe(false);
  });

  it("flags failed systemd units", () => {
    expect(
      serviceNeedsAttention({
        name: "foo.service",
        kind: "systemd",
        state: "failed",
        enabled: true,
      }),
    ).toBe(true);
  });

  it("ignores active oneshot units (exited substate)", () => {
    expect(
      serviceNeedsAttention({
        name: "apparmor.service",
        kind: "systemd",
        state: "active",
        enabled: true,
        detail: "type=oneshot · sub=exited · file=enabled",
      }),
    ).toBe(false);
  });

  it("ignores transient apt timer units when dead", () => {
    expect(
      serviceNeedsAttention({
        name: "apt-daily.service",
        kind: "systemd",
        state: "dead",
        enabled: true,
      }),
    ).toBe(false);
  });

  it("flags enabled inactive daemons", () => {
    expect(
      serviceNeedsAttention({
        name: "nginx.service",
        kind: "systemd",
        state: "inactive",
        enabled: true,
        detail: "type=simple · sub=dead · file=enabled",
      }),
    ).toBe(true);
  });

  it("uses running for windows", () => {
    expect(
      serviceNeedsAttention({
        name: "Spooler",
        kind: "windows_service",
        state: "stopped",
        enabled: true,
      }),
    ).toBe(true);
  });
});
