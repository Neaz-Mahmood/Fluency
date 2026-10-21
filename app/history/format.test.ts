import { describe, expect, it } from "vitest";

import { formatSessionDate, formatSessionTitle } from "./format";

describe("formatSessionTitle", () => {
  it("returns Placement when mode is placement", () => {
    expect(formatSessionTitle({ mode: "placement", scenarioId: "cafe" })).toBe("Placement");
  });

  it("returns the scenario title for known scenarios", () => {
    expect(formatSessionTitle({ mode: "conversation", scenarioId: "cafe" })).toBe(
      "Ordering at a café",
    );
  });

  it("returns Conversation when scenarioId is null or unknown", () => {
    expect(formatSessionTitle({ mode: "conversation", scenarioId: null })).toBe("Conversation");
    expect(formatSessionTitle({ mode: "conversation", scenarioId: "unknown-scenario" })).toBe(
      "Conversation",
    );
  });
});

describe("formatSessionDate", () => {
  it("formats dates with medium date and short time", () => {
    const formatted = formatSessionDate(new Date("2026-03-15T14:30:00Z"));
    expect(formatted).toBeTruthy();
    expect(typeof formatted).toBe("string");
  });
});
