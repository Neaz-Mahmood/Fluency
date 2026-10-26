import { describe, expect, it } from "vitest";

import { gateVerdict, parseLatencyArgs, summarizeLatency, type LatencySummary } from "./latency.ts";

describe("summarizeLatency", () => {
  it("returns null on an empty array", () => {
    expect(summarizeLatency([])).toBeNull();
  });

  it("summarizes 10 known values into n, p50, p90, min, max", () => {
    const values = [500, 200, 800, 100, 300, 900, 400, 1000, 700, 600];
    const summary = summarizeLatency(values);
    expect(summary).toEqual({
      n: 10,
      p50: 500,
      p90: 900,
      min: 100,
      max: 1000,
    });
  });
});

describe("gateVerdict", () => {
  it("returns 'too few turns' for 19 turns", () => {
    const summary: LatencySummary = {
      n: 19,
      p50: 600,
      p90: 800,
      min: 400,
      max: 1000,
    };
    expect(gateVerdict(summary)).toBe("too few turns");
  });

  it("returns 'pass' for 20 turns with p50 749 and p90 949", () => {
    const summary: LatencySummary = {
      n: 20,
      p50: 749,
      p90: 949,
      min: 400,
      max: 1000,
    };
    expect(gateVerdict(summary)).toBe("pass");
  });

  it("returns 'fail' when p50 is 750", () => {
    const summary: LatencySummary = {
      n: 20,
      p50: 750,
      p90: 900,
      min: 400,
      max: 1000,
    };
    expect(gateVerdict(summary)).toBe("fail");
  });

  it("returns 'fail' when p90 is 950", () => {
    const summary: LatencySummary = {
      n: 20,
      p50: 700,
      p90: 950,
      min: 400,
      max: 1000,
    };
    expect(gateVerdict(summary)).toBe("fail");
  });
});

describe("parseLatencyArgs", () => {
  const validUuid = "123e4567-e89b-12d3-a456-426614174000";

  it("parses both flag forms (--since and --since=, --learner and --learner=)", () => {
    expect(parseLatencyArgs(["--since", "2026-10-26", "--learner", validUuid])).toEqual({
      since: "2026-10-26",
      learnerId: validUuid,
    });

    expect(parseLatencyArgs(["--since=2026-10-26", `--learner=${validUuid}`])).toEqual({
      since: "2026-10-26",
      learnerId: validUuid,
    });
  });

  it("returns defaults when no arguments are provided", () => {
    expect(parseLatencyArgs([])).toEqual({
      since: null,
      learnerId: null,
    });
  });

  it("rejects a bad date", () => {
    const res = parseLatencyArgs(["--since", "not-a-date"]);
    expect(res).toHaveProperty("error");

    const res2 = parseLatencyArgs(["--since=2026-02-31"]);
    expect(res2).toHaveProperty("error");
  });

  it("rejects a bad UUID", () => {
    const res = parseLatencyArgs(["--learner", "invalid-uuid"]);
    expect(res).toHaveProperty("error");

    const res2 = parseLatencyArgs(["--learner=123"]);
    expect(res2).toHaveProperty("error");
  });

  it("rejects an unknown argument", () => {
    const res = parseLatencyArgs(["--unknown-flag"]);
    expect(res).toHaveProperty("error");
  });
});
