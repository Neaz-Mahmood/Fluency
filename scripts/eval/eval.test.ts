import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  formatReport,
  noEdits,
  parseGoldenSet,
  score,
  type GoldenItem,
} from "./eval";

describe("parseGoldenSet", () => {
  it("accepts the real golden file", () => {
    const goldenPath = fileURLToPath(new URL("./golden/bn-en.json", import.meta.url));
    const raw = JSON.parse(readFileSync(goldenPath, "utf-8"));
    const items = parseGoldenSet(raw);
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items[0]).toEqual({
      id: "bn-en-001",
      input: "I am student of a university in Dhaka.",
      expected_edits: [{ original: "am student", correction: "am a student" }],
      is_error_free: false,
    });
  });

  it("rejects non-array root", () => {
    expect(() => parseGoldenSet(null)).toThrow("Golden set must be an array.");
    expect(() => parseGoldenSet({})).toThrow("Golden set must be an array.");
  });

  it("rejects non-object items", () => {
    expect(() => parseGoldenSet(["not-an-object"])).toThrow(
      "Golden item 0: item must be an object.",
    );
  });

  it.each([
    {
      name: "false when expected_edits is empty",
      item: { id: "1", input: "Hello", expected_edits: [], is_error_free: false },
    },
    {
      name: "true when expected_edits has items",
      item: {
        id: "1",
        input: "Hello",
        expected_edits: [{ original: "a", correction: "b" }],
        is_error_free: true,
      },
    },
  ])("rejects a mismatched is_error_free ($name)", ({ item }) => {
    expect(() => parseGoldenSet([item])).toThrow(/Golden item 0: is_error_free must match/);
  });

  it.each([
    {
      field: "id",
      item: { input: "Hello", expected_edits: [], is_error_free: true },
      pattern: /Golden item 0: id must be a string/,
    },
    {
      field: "input",
      item: { id: "1", expected_edits: [], is_error_free: true },
      pattern: /Golden item 0: input must be a string/,
    },
    {
      field: "expected_edits",
      item: { id: "1", input: "Hello", is_error_free: true },
      pattern: /Golden item 0: expected_edits must be an array/,
    },
    {
      field: "is_error_free",
      item: { id: "1", input: "Hello", expected_edits: [] },
      pattern: /Golden item 0: is_error_free must be a boolean/,
    },
    {
      field: "edit original/correction",
      item: {
        id: "1",
        input: "Hello",
        expected_edits: [{ original: "a" }],
        is_error_free: false,
      },
      pattern: /Golden item 0: each edit must have original and correction strings/,
    },
  ])("rejects a missing or invalid field ($field)", ({ item, pattern }) => {
    expect(() => parseGoldenSet([item])).toThrow(pattern);
  });

  it("rejects a duplicate id", () => {
    const items = [
      { id: "bn-01", input: "Hello", expected_edits: [], is_error_free: true },
      { id: "bn-01", input: "World", expected_edits: [], is_error_free: true },
    ];
    expect(() => parseGoldenSet(items)).toThrow('Golden item 1: duplicate id "bn-01".');
  });
});

describe("score", () => {
  const errorFreeItem: GoldenItem = {
    id: "ef-1",
    input: "Correct sentence.",
    expected_edits: [],
    is_error_free: true,
  };
  const errorItem: GoldenItem = {
    id: "err-1",
    input: "Wrong sentence.",
    expected_edits: [{ original: "Wrong", correction: "Right" }],
    is_error_free: false,
  };

  it("counts over-corrections and calculates the rate", () => {
    const items: GoldenItem[] = [
      errorFreeItem,
      { ...errorFreeItem, id: "ef-2" },
      { ...errorFreeItem, id: "ef-3" },
      { ...errorFreeItem, id: "ef-4" },
    ];
    // 1 item has a predicted edit (over-corrected), 3 have none
    const predictions = [
      [{ original: "Correct", correction: "Right" }],
      [],
      [],
      [],
    ];
    const result = score(items, predictions);
    expect(result.total).toBe(4);
    expect(result.errorFree).toBe(4);
    expect(result.overCorrected).toBe(1);
    expect(result.overCorrectionRate).toBe(0.25);
  });

  it("handles the zero-error-free case without dividing by zero", () => {
    const items: GoldenItem[] = [errorItem];
    const predictions = [[{ original: "Wrong", correction: "Right" }]];
    const result = score(items, predictions);
    expect(result.total).toBe(1);
    expect(result.errorFree).toBe(0);
    expect(result.overCorrected).toBe(0);
    expect(result.overCorrectionRate).toBe(0);
  });

  it("counts exact matches and matches each expected edit at most once", () => {
    const items: GoldenItem[] = [
      {
        id: "multi-1",
        input: "Two errors here.",
        expected_edits: [
          { original: "Two", correction: "Three" },
          { original: "here", correction: "there" },
        ],
        is_error_free: false,
      },
    ];
    // Predictions:
    // - one exact match: { original: "Two", correction: "Three" }
    // - duplicate of the first: should not match again
    // - wrong correction: { original: "here", correction: "where" } (no match)
    // - completely unrelated: { original: "other", correction: "else" }
    const predictions = [
      [
        { original: "Two", correction: "Three" },
        { original: "Two", correction: "Three" },
        { original: "here", correction: "where" },
        { original: "other", correction: "else" },
      ],
    ];
    const result = score(items, predictions);
    expect(result.expectedEdits).toBe(2);
    expect(result.predictedEdits).toBe(4);
    expect(result.matchedEdits).toBe(1);
  });
});

describe("golden file bn-en.json", () => {
  const goldenPath = fileURLToPath(new URL("./golden/bn-en.json", import.meta.url));
  const raw = JSON.parse(readFileSync(goldenPath, "utf-8"));
  const items = parseGoldenSet(raw);

  it("parses with parseGoldenSet and has at least 200 items", () => {
    expect(items.length).toBeGreaterThanOrEqual(200);
  });

  it("has at least 30% error-free items", () => {
    const errorFree = items.filter((item) => item.is_error_free).length;
    expect(errorFree / items.length).toBeGreaterThanOrEqual(0.3);
  });

  it("has ids bn-en-001 ... in order with no gaps", () => {
    for (let index = 0; index < items.length; index++) {
      const expectedId = `bn-en-${String(index + 1).padStart(3, "0")}`;
      expect(items[index].id).toBe(expectedId);
    }
  });

  it("has every expected_edits[].original occurring exactly once in input", () => {
    for (const item of items) {
      for (const edit of item.expected_edits) {
        expect(item.input.split(edit.original).length - 1).toBe(1);
      }
    }
  });

  it("has no two items with the same input", () => {
    const seen = new Set<string>();
    for (const item of items) {
      expect(seen.has(item.input)).toBe(false);
      seen.add(item.input);
    }
  });
});

describe("noEdits baseline corrector", () => {
  it("returns an empty edit array", async () => {
    expect(await noEdits("Any sentence.")).toEqual([]);
  });
});

describe("formatReport", () => {
  it("formats the score summary into aligned lines", () => {
    const report = formatReport({
      total: 10,
      errorFree: 4,
      overCorrected: 0,
      overCorrectionRate: 0,
      expectedEdits: 6,
      predictedEdits: 0,
      matchedEdits: 0,
    });
    expect(report).toBe(
      "Sentences: 10 (4 error-free)\n" +
        "Over-correction: 0/4 (0.0%)\n" +
        "Edits: expected 6, predicted 0, matched 0",
    );
  });
});
