import { describe, expect, it } from "vitest";
import { agentWasRenamedInFleet } from "./agent-labels.js";

describe("agentWasRenamedInFleet", () => {
  it("detects Fleet rename vs template hostname", () => {
    expect(
      agentWasRenamedInFleet("Pangolin-proxy", {
        machineHostname: "debian13univ",
      }),
    ).toBe(true);
    expect(
      agentWasRenamedInFleet("mailcow", { machineHostname: "mailcow" }),
    ).toBe(false);
  });
});
