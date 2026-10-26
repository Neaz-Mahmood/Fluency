import { describe, expect, it } from "vitest";

import {
  CALL_TIMEOUT_MS,
  formatTable,
  measure,
  parseOnly,
  parseRuns,
  percentile,
  summarize,
  type Row,
  type Stream,
  SYSTEM_PROMPT,
  textFromChatCompletionData,
  TURNS,
} from "./ttft.ts";

describe("percentile", () => {
  it("computes p50 and p90 of 1..10", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 90)).toBe(9);
  });

  it("handles unsorted arrays without mutating the input", () => {
    const unsorted = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    expect(percentile(unsorted, 50)).toBe(5);
    expect(percentile(unsorted, 90)).toBe(9);
    expect(unsorted[0]).toBe(10);
  });

  it("computes percentile for a single value", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 90)).toBe(42);
    expect(percentile([42], 100)).toBe(42);
  });

  it("throws on an empty array", () => {
    expect(() => percentile([], 50)).toThrow("Cannot compute percentile of an empty array.");
  });

  it("throws when p is out of bounds", () => {
    expect(() => percentile([1, 2, 3], -1)).toThrow("Percentile p must be between 0 and 100");
    expect(() => percentile([1, 2, 3], 101)).toThrow("Percentile p must be between 0 and 100");
  });
});

describe("summarize", () => {
  it("summarizes measurements into a Row with nearest-rank percentiles", () => {
    const measurements = Array.from({ length: 10 }, (_, i) => ({
      firstTokenMs: (i + 1) * 10,
      totalMs: (i + 1) * 50,
    }));

    const row = summarize("claude-haiku-5-5", "anthropic", measurements);
    expect(row).toEqual({
      label: "claude-haiku-5-5",
      route: "anthropic",
      runs: 10,
      ttftP50: 50,
      ttftP90: 90,
      totalP50: 250,
    });
  });

  it("throws when summarizing an empty measurement list", () => {
    expect(() => summarize("model", "route", [])).toThrow("Cannot summarize empty measurements.");
  });
});

describe("formatTable", () => {
  it("contains the headers and a row", () => {
    const row: Row = {
      label: "claude-haiku-5-5",
      route: "anthropic",
      runs: 10,
      ttftP50: 240,
      ttftP90: 310,
      totalP50: 650,
    };

    const table = formatTable([row]);
    expect(table).toContain("Model");
    expect(table).toContain("Route");
    expect(table).toContain("Runs");
    expect(table).toContain("TTFT p50");
    expect(table).toContain("TTFT p90");
    expect(table).toContain("Total p50");
    expect(table).toContain("claude-haiku-5-5");
    expect(table).toContain("anthropic");
    expect(table).toContain("10");
    expect(table).toContain("240ms");
    expect(table).toContain("310ms");
    expect(table).toContain("650ms");
  });
});

describe("measure", () => {
  it("measures with fake async generator, skips empty chunks, and ensures firstTokenMs <= totalMs", async () => {
    const fakeStream: Stream = (_system, _user, signal) => {
      return (async function* () {
        yield "";
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (signal.aborted) return;
        yield "Hello";
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (signal.aborted) return;
        yield " world";
      })();
    };

    const measurement = await measure(fakeStream, "sys", "user");
    expect(measurement.firstTokenMs).toBeGreaterThanOrEqual(15);
    expect(measurement.firstTokenMs).toBeLessThanOrEqual(measurement.totalMs);
  });

  it("throws when a stream produces no chunks", async () => {
    const emptyStream: Stream = (_system, _user, signal) => {
      return (async function* () {
        if (signal.aborted) return;
      })();
    };

    await expect(measure(emptyStream, "sys", "user")).rejects.toThrow(
      "No text arrived from stream.",
    );
  });

  it("throws when a stream produces only empty chunks", async () => {
    const onlyEmptyStream: Stream = (_system, _user, signal) => {
      return (async function* () {
        if (signal.aborted) return;
        yield "";
        yield "";
      })();
    };

    await expect(measure(onlyEmptyStream, "sys", "user")).rejects.toThrow(
      "No text arrived from stream.",
    );
  });

  it("rejects with a timeout error when a stream hangs until aborted", async () => {
    const fake: Stream = (_system, _user, signal) => {
      return (async function* () {
        if (!signal.aborted) {
          await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        }
        return;
      })();
    };

    await expect(measure(fake, "s", "u", 50)).rejects.toThrow("Timed out after 50 ms.");
  });

  it("rejects with timeout when the stream iterator throws on abort", async () => {
    const throwingStream: Stream = (_system, _user, signal) => {
      return (async function* () {
        await new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("operation aborted")), {
            once: true,
          }),
        );
      })();
    };

    await expect(measure(throwingStream, "s", "u", 50)).rejects.toThrow("Timed out after 50 ms.");
  });
});

describe("fixtures and options", () => {
  it("defines CALL_TIMEOUT_MS as 30 seconds", () => {
    expect(CALL_TIMEOUT_MS).toBe(30_000);
  });
  it("defines 10 café turns", () => {
    expect(TURNS).toHaveLength(10);
    for (const turn of TURNS) {
      expect(typeof turn).toBe("string");
      expect(turn.trim().length).toBeGreaterThan(0);
    }
  });

  it("defines SYSTEM_PROMPT with rules, scenario, A2 level, and summary", () => {
    expect(SYSTEM_PROMPT).toContain("Rules:");
    expect(SYSTEM_PROMPT).toContain("Scenario: you are a café barista.");
    expect(SYSTEM_PROMPT).toContain("Learner level: A2 (beginner).");
    expect(SYSTEM_PROMPT).toContain("What you know about this learner from earlier sessions");
  });

  it("parses --runs argument", () => {
    expect(parseRuns([])).toBe(10);
    expect(parseRuns(["--runs", "5"])).toBe(5);
    expect(parseRuns(["--runs=3"])).toBe(3);
    expect(parseRuns(["--runs", "invalid"])).toBe(10);
  });

  it("parses --only argument", () => {
    expect(parseOnly([])).toBeNull();
    expect(parseOnly(["--only", "livekit"])).toBe("livekit");
    expect(parseOnly(["--runs", "5", "--only=google"])).toBe("google");
  });
});

describe("textFromChatCompletionData", () => {
  it("reads the delta text and ignores role-only and usage chunks", () => {
    expect(textFromChatCompletionData('{"choices":[{"delta":{"content":"Hi"}}]}')).toBe("Hi");
    expect(textFromChatCompletionData('{"choices":[{"delta":{"role":"assistant"}}]}')).toBe("");
    expect(textFromChatCompletionData('{"choices":[],"usage":{"total_tokens":9}}')).toBe("");
  });
});
