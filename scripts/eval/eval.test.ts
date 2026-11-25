import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  checkGate,
  createModelCorrector,
  formatReport,
  noEdits,
  normalizeEdit,
  parseBaseline,
  parseGoldenSet,
  score,
  type Baseline,
  type Generate,
  type GoldenItem,
  type ScoreResult,
} from "./eval.ts";

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

describe("normalizeEdit", () => {
  const input = "I am student of a university.";

  it("normalizes insertion examples with different originals to the same span", () => {
    const expected = { start: 5, end: 5, text: "a" };
    expect(normalizeEdit(input, { original: "am student", correction: "am a student" })).toEqual(
      expected,
    );
    expect(normalizeEdit(input, { original: "student", correction: "a student" })).toEqual(
      expected,
    );
    expect(normalizeEdit(input, { original: "am", correction: "am a" })).toEqual(expected);
  });

  it("returns null when the original text is not in the input", () => {
    expect(normalizeEdit(input, { original: "college", correction: "university" })).toBeNull();
  });

  it("returns null for a no-op edit", () => {
    expect(normalizeEdit(input, { original: "student", correction: "student" })).toBeNull();
  });

  it("normalizes deletions to the deleted span with empty text", () => {
    const discussInput = "We will discuss about the plan.";
    const expected = { start: 16, end: 21, text: "" };
    const res1 = normalizeEdit(discussInput, {
      original: "discuss about the plan",
      correction: "discuss the plan",
    });
    const res2 = normalizeEdit(discussInput, {
      original: "discuss about",
      correction: "discuss",
    });
    expect(res1).toEqual(expected);
    expect(res1!.end - res1!.start).toBe(5);
    expect(res2).toEqual(expected);
    expect(res2!.end - res2!.start).toBe(5);
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
    const predictions = [[{ original: "Correct", correction: "Right" }], [], [], []];
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

  it("matches am student → am a student against student → a student", () => {
    const item: GoldenItem = {
      id: "match-1",
      input: "I am student of a university in Dhaka.",
      expected_edits: [{ original: "am student", correction: "am a student" }],
      is_error_free: false,
    };
    const predictions = [[{ original: "student", correction: "a student" }]];
    const result = score([item], predictions);
    expect(result.expectedEdits).toBe(1);
    expect(result.predictedEdits).toBe(1);
    expect(result.matchedEdits).toBe(1);
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(1);
    expect(result.f05).toBe(1);
  });

  it("still counts each expected edit at most once", () => {
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

  it("computes precision, recall and f05 on a small hand-checked case", () => {
    const items: GoldenItem[] = [
      {
        id: "calc-1",
        input: "Two errors here.",
        expected_edits: [
          { original: "Two", correction: "Three" },
          { original: "here", correction: "there" },
        ],
        is_error_free: false,
      },
    ];
    // 4 predictions, 1 match -> precision = 1/4 = 0.25, recall = 1/2 = 0.5
    // f05 = (1.25 * 0.25 * 0.5) / (0.25 * 0.25 + 0.5) = 0.15625 / 0.5625 = 5/18 ≈ 0.278
    const predictions = [
      [
        { original: "Two", correction: "Three" },
        { original: "Two", correction: "Three" },
        { original: "here", correction: "where" },
        { original: "other", correction: "else" },
      ],
    ];
    const result = score(items, predictions);
    expect(result.precision).toBe(0.25);
    expect(result.recall).toBe(0.5);
    expect(result.f05).toBeCloseTo(5 / 18, 5);
  });

  it("gives f05 === 0 when nothing is predicted", () => {
    const items: GoldenItem[] = [errorItem];
    const predictions = [[]];
    const result = score(items, predictions);
    expect(result.precision).toBe(0);
    expect(result.recall).toBe(0);
    expect(result.f05).toBe(0);
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
  it("returns an empty edit array for each input", async () => {
    expect(await noEdits(["Any sentence.", "Another sentence."])).toEqual([[], []]);
  });
});

describe("createModelCorrector", () => {
  it("batches 25 inputs into 2 calls and maps edits to the right sentences", async () => {
    const calls: { system: string; input: string }[] = [];
    const fakeGenerate: Generate = async (system, input) => {
      calls.push({ system, input });
      if (calls.length === 1) {
        return JSON.stringify({
          items: [
            {
              line: 1,
              edits: [{ original: "error1", correction: "fixed1", code: "R:OTHER" }],
              minimal_correction: "Sentence with fixed1.",
              explanation: "Fixed line 1",
            },
          ],
          vocabulary: [],
        });
      }
      return JSON.stringify({
        items: [
          {
            line: 3,
            edits: [{ original: "error3", correction: "fixed3", code: "R:OTHER" }],
            minimal_correction: "Sentence with fixed3.",
            explanation: "Fixed line 3",
          },
        ],
        vocabulary: [],
      });
    };

    const corrector = createModelCorrector(fakeGenerate);
    const inputs = Array.from({ length: 25 }, (_, i) => {
      if (i === 0) return "Sentence with error1.";
      if (i === 22) return "Sentence with error3.";
      return `Sentence number ${i + 1}.`;
    });

    const predictions = await corrector(inputs);

    expect(calls).toHaveLength(2);
    const firstInputLines = calls[0].input.split("\n");
    expect(firstInputLines).toHaveLength(20);
    expect(firstInputLines[0]).toContain("L1 (typed):");
    expect(firstInputLines[19]).toContain("L20 (typed):");

    expect(predictions).toHaveLength(25);
    expect(predictions[0]).toEqual([{ original: "error1", correction: "fixed1" }]);
    expect(predictions[22]).toEqual([{ original: "error3", correction: "fixed3" }]);
    expect(predictions[1]).toEqual([]);
    expect(predictions[21]).toEqual([]);
    expect(predictions[23]).toEqual([]);
  });

  it("throws when model output cannot be parsed", async () => {
    const badGenerate: Generate = async () => "Not valid json";
    const corrector = createModelCorrector(badGenerate);
    await expect(corrector(["Some input."])).rejects.toThrow(
      "Could not parse the corrector's output for batch 1.",
    );
  });
});

describe("checkGate", () => {
  const baseResult: ScoreResult = {
    total: 100,
    errorFree: 50,
    overCorrected: 2,
    overCorrectionRate: 0.04,
    expectedEdits: 10,
    predictedEdits: 5,
    matchedEdits: 4,
    precision: 0.8,
    recall: 0.4,
    f05: 0.667,
  };

  const baseline: Baseline = {
    model: "claude-opus-5-5",
    measuredAt: "2026-10-22",
    sentences: 100,
    errorFree: 50,
    overCorrected: 2,
    overCorrectionRate: 0.04,
    precision: 0.8,
    recall: 0.4,
    f05: 0.667,
  };

  it("passes at 4% over-correction", () => {
    expect(checkGate(baseResult, null)).toEqual([]);
  });

  it("fails at exactly 5% over-correction", () => {
    const atLimit: ScoreResult = {
      ...baseResult,
      overCorrected: 2,
      errorFree: 40,
      overCorrectionRate: 0.05,
    };
    expect(checkGate(atLimit, null)).toEqual(["Over-correction 5.0% is at or above the 5% limit."]);
  });

  it("fails when overCorrected is baseline + 2", () => {
    const roseTwo: ScoreResult = {
      ...baseResult,
      overCorrected: baseline.overCorrected + 2,
      overCorrectionRate: 0.04,
    };
    expect(checkGate(roseTwo, baseline)).toEqual([
      `Over-correction rose from ${baseline.overCorrected} to 4 error-free sentences.`,
    ]);
  });

  it("passes at baseline + 1", () => {
    const roseOne: ScoreResult = {
      ...baseResult,
      overCorrected: baseline.overCorrected + 1,
      overCorrectionRate: 0.04,
    };
    expect(checkGate(roseOne, baseline)).toEqual([]);
  });
});

describe("parseBaseline", () => {
  const valid: Baseline = {
    model: "claude-opus-5-5",
    measuredAt: "2026-10-22",
    sentences: 200,
    errorFree: 80,
    overCorrected: 2,
    overCorrectionRate: 0.025,
    precision: 0.75,
    recall: 0.6,
    f05: 0.71,
  };

  it("accepts a valid baseline object", () => {
    expect(parseBaseline(valid)).toEqual(valid);
  });

  it.each([
    "model",
    "measuredAt",
    "sentences",
    "errorFree",
    "overCorrected",
    "overCorrectionRate",
    "precision",
    "recall",
    "f05",
  ] as const)("rejects when %s is missing or invalid", (field) => {
    const copy = { ...valid, [field]: undefined };
    expect(parseBaseline(copy)).toBeNull();
  });

  it("rejects non-object or null input", () => {
    expect(parseBaseline(null)).toBeNull();
    expect(parseBaseline("string")).toBeNull();
    expect(parseBaseline([])).toBeNull();
  });
});

describe("formatReport", () => {
  it("formats the score summary into aligned lines including F0.5", () => {
    const report = formatReport({
      total: 10,
      errorFree: 4,
      overCorrected: 0,
      overCorrectionRate: 0,
      expectedEdits: 6,
      predictedEdits: 0,
      matchedEdits: 0,
      precision: 0.5,
      recall: 0.25,
      f05: 0.412,
    });
    expect(report).toBe(
      "Sentences: 10 (4 error-free)\n" +
        "Over-correction: 0/4 (0.0%)\n" +
        "Edits: expected 6, predicted 0, matched 0\n" +
        "Edit F0.5: 0.412 (precision 0.500, recall 0.250; normalized span match, not ERRANT)",
    );
  });
});
