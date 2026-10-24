import { describe, expect, it } from "vitest";

import {
  applyEdits,
  buildFeedbackInput,
  buildFeedbackSystemPrompt,
  explanationLanguage,
  FEEDBACK_PROMPT_TEMPLATE,
  MAX_ERROR_CODE_LENGTH,
  MAX_VOCABULARY,
  parseFeedback,
  splitSentences,
} from "./feedback";

describe("explanationLanguage", () => {
  it("gives Bangla for bn-BD at A1, A2, and null", () => {
    expect(explanationLanguage({ nativeLanguage: "bn-BD", cefrSpeaking: "A1" })).toBe("Bangla");
    expect(explanationLanguage({ nativeLanguage: "bn-BD", cefrSpeaking: "A2" })).toBe("Bangla");
    expect(explanationLanguage({ nativeLanguage: "bn-BD", cefrSpeaking: null })).toBe("Bangla");
  });

  it("gives English for bn-BD at B1", () => {
    expect(explanationLanguage({ nativeLanguage: "bn-BD", cefrSpeaking: "B1" })).toBe("English");
    expect(explanationLanguage({ nativeLanguage: "bn-BD", cefrSpeaking: "B2" })).toBe("English");
  });

  it("gives English for null native language at A1", () => {
    expect(explanationLanguage({ nativeLanguage: null, cefrSpeaking: "A1" })).toBe("English");
  });
});

describe("buildFeedbackSystemPrompt", () => {
  it("contains in Bangla and no {language} placeholder for Bangla", () => {
    const prompt = buildFeedbackSystemPrompt("Bangla");
    expect(prompt).toContain("in Bangla");
    expect(prompt).not.toContain("{language}");
  });

  it("contains in English and no {language} placeholder for English", () => {
    const prompt = buildFeedbackSystemPrompt("English");
    expect(prompt).toContain("in English");
    expect(prompt).not.toContain("{language}");
  });

  it("never asks for a target number of errors", () => {
    expect(FEEDBACK_PROMPT_TEMPLATE).not.toMatch(/\bat least \d+ (errors|mistakes)\b/i);
    expect(buildFeedbackSystemPrompt("Bangla")).not.toMatch(/\bat least \d+ (errors|mistakes)\b/i);
    expect(buildFeedbackSystemPrompt("English")).not.toMatch(/\bat least \d+ (errors|mistakes)\b/i);
  });
});

describe("buildFeedbackInput", () => {
  it("numbers learner lines from 1, labels partner lines, defaults null inputMode to typed, skips empty lines, collapses newlines, and tracks learner lines and indexes", () => {
    const lines = [
      { role: "assistant" as const, content: "Hello! What did you do today?", inputMode: null },
      { role: "user" as const, content: "   ", inputMode: "voice" as const },
      { role: "user" as const, content: "I go to\nmarket yesterday.", inputMode: "voice" as const },
      { role: "assistant" as const, content: "What did\nyou buy?", inputMode: null },
      { role: "user" as const, content: "I bought some fish.", inputMode: null },
    ];

    const result = buildFeedbackInput(lines);

    expect(result.input).toBe(
      [
        "Partner: Hello! What did you do today?",
        "L1 (voice): I go to market yesterday.",
        "Partner: What did you buy?",
        "L2 (typed): I bought some fish.",
      ].join("\n"),
    );

    expect(result.learnerLines).toEqual(["I go to market yesterday.", "I bought some fish."]);

    expect(result.learnerIndexes).toEqual([2, 4]);
  });
});

describe("applyEdits", () => {
  it("applies two edits in order", () => {
    const text = "I go to my cousin house on Friday.";
    const edits = [
      { original: "go", correction: "went", code: "R:VERB:TENSE" },
      { original: "cousin house", correction: "cousin's house", code: "M:NOUN:POSS" },
    ];
    expect(applyEdits(text, edits)).toBe("I went to my cousin's house on Friday.");
  });

  it("skips a missing edit", () => {
    const text = "I go to my cousin house.";
    const edits = [
      { original: "market", correction: "bazaar", code: "OTHER" },
      { original: "go", correction: "went", code: "R:VERB:TENSE" },
    ];
    expect(applyEdits(text, edits)).toBe("I went to my cousin house.");
  });
});

describe("parseFeedback", () => {
  const learnerLines = [
    "I go to my cousin house on Friday.",
    "It was really fun.",
    "My cousin is engineer in a big company.",
  ];

  it("parses fenced JSON with ```json and ``` fences", () => {
    const json = JSON.stringify({
      items: [
        {
          line: 1,
          edits: [{ original: "go", correction: "went", code: "R:VERB:TENSE" }],
          minimal_correction: "I went to my cousin house on Friday.",
          fluency_upgrade: null,
          l1_interference_cause: "Bangla past tense interference",
          explanation: "Use went for past actions.",
        },
      ],
      vocabulary: [
        {
          item: "cousin's house",
          meaning: "relative's home",
          example: "I visited my cousin's house.",
        },
      ],
    });

    const fenced = `\`\`\`json\n${json}\n\`\`\``;
    const parsed = parseFeedback(fenced, learnerLines);

    expect(parsed).toEqual({
      items: [
        {
          line: 1,
          edits: [{ original: "go", correction: "went", code: "R:VERB:TENSE" }],
          minimalCorrection: "I went to my cousin house on Friday.",
          fluencyUpgrade: null,
          l1Cause: "Bangla past tense interference",
          explanation: "Use went for past actions.",
        },
      ],
      vocabulary: [
        {
          item: "cousin's house",
          meaning: "relative's home",
          example: "I visited my cousin's house.",
        },
      ],
    });
  });

  it("returns null for non-JSON text and for a JSON array", () => {
    expect(parseFeedback("not json at all", learnerLines)).toBeNull();
    expect(parseFeedback("[]", learnerLines)).toBeNull();
    expect(parseFeedback("[1, 2, 3]", learnerLines)).toBeNull();
    expect(parseFeedback('[{"line": 1}]', learnerLines)).toBeNull();
    expect(parseFeedback('```json\n[{"line": 1}]\n```', learnerLines)).toBeNull();
    expect(parseFeedback("", learnerLines)).toBeNull();
  });

  it("drops an item with a line out of range, and a duplicate line", () => {
    const payload = JSON.stringify({
      items: [
        {
          line: 0,
          edits: [{ original: "go", correction: "went", code: "R:VERB:TENSE" }],
          explanation: "Out of range below 1.",
        },
        {
          line: 99,
          edits: [{ original: "go", correction: "went", code: "R:VERB:TENSE" }],
          explanation: "Out of range above length.",
        },
        {
          line: 1,
          edits: [{ original: "go", correction: "went", code: "R:VERB:TENSE" }],
          explanation: "First valid item for line 1.",
        },
        {
          line: 1,
          edits: [{ original: "cousin house", correction: "cousin's house", code: "M:NOUN:POSS" }],
          explanation: "Duplicate line 1 should be dropped.",
        },
      ],
      vocabulary: [],
    });

    const parsed = parseFeedback(payload, learnerLines);
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0].line).toBe(1);
    expect(parsed?.items[0].explanation).toBe("First valid item for line 1.");
  });

  it("drops an edit whose original isn't in the line and rebuilds minimalCorrection from kept edits", () => {
    const payload = JSON.stringify({
      items: [
        {
          line: 1,
          edits: [
            { original: "go", correction: "went", code: "R:VERB:TENSE" },
            { original: "hallucinated words", correction: "fixed", code: "OTHER" },
          ],
          minimal_correction: "Model hallucinated whole minimal correction",
          fluency_upgrade: null,
          l1_interference_cause: null,
          explanation: "Fix verb tense.",
        },
      ],
      vocabulary: [],
    });

    const parsed = parseFeedback(payload, learnerLines);
    expect(parsed?.items).toHaveLength(1);
    const item = parsed!.items[0];
    expect(item.edits).toEqual([{ original: "go", correction: "went", code: "R:VERB:TENSE" }]);
    // Because an edit was dropped, model's minimal_correction is ignored and rebuilt from kept edits
    expect(item.minimalCorrection).toBe("I went to my cousin house on Friday.");
  });

  it("fills code OTHER when it is missing", () => {
    const payload = JSON.stringify({
      items: [
        {
          line: 1,
          edits: [{ original: "go", correction: "went" }],
          explanation: "Fix verb tense.",
        },
      ],
      vocabulary: [],
    });

    const parsed = parseFeedback(payload, learnerLines);
    expect(parsed?.items[0].edits[0].code).toBe("OTHER");
  });

  it("truncates error code to MAX_ERROR_CODE_LENGTH", () => {
    const longCode = "X:".repeat(50);
    const payload = JSON.stringify({
      items: [
        {
          line: 1,
          edits: [{ original: "go", correction: "went", code: longCode }],
          explanation: "Fix verb tense.",
        },
      ],
      vocabulary: [],
    });

    const parsed = parseFeedback(payload, learnerLines);
    expect(parsed?.items[0].edits[0].code.length).toBe(MAX_ERROR_CODE_LENGTH);
  });

  it("drops an item with no edits and no upgrade", () => {
    const payload = JSON.stringify({
      items: [
        {
          line: 2,
          edits: [],
          fluency_upgrade: null,
          explanation: "Line is good.",
        },
      ],
      vocabulary: [],
    });

    const parsed = parseFeedback(payload, learnerLines);
    expect(parsed?.items).toHaveLength(0);
  });

  it("keeps an upgrade-only item (edits [])", () => {
    const payload = JSON.stringify({
      items: [
        {
          line: 2,
          edits: [],
          fluency_upgrade: "It was a lot of fun.",
          explanation: "More natural phrasing.",
        },
      ],
      vocabulary: [],
    });

    const parsed = parseFeedback(payload, learnerLines);
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0].edits).toEqual([]);
    expect(parsed?.items[0].fluencyUpgrade).toBe("It was a lot of fun.");
    expect(parsed?.items[0].minimalCorrection).toBe("It was really fun.");
  });

  it("nulls an upgrade equal to the line", () => {
    const payload = JSON.stringify({
      items: [
        {
          line: 2,
          edits: [],
          fluency_upgrade: "It was really fun.",
          explanation: "No real upgrade.",
        },
      ],
      vocabulary: [],
    });

    // Upgrade equals lineText, so fluencyUpgrade becomes null.
    // Since edits is empty and upgrade is null, the whole item is dropped.
    const parsed = parseFeedback(payload, learnerLines);
    expect(parsed?.items).toHaveLength(0);
  });

  it("nulls an upgrade equal to minimalCorrection", () => {
    const payload = JSON.stringify({
      items: [
        {
          line: 1,
          edits: [{ original: "go", correction: "went", code: "R:VERB:TENSE" }],
          minimal_correction: "I went to my cousin house on Friday.",
          fluency_upgrade: "I went to my cousin house on Friday.",
          explanation: "Upgrade identical to minimal correction.",
        },
      ],
      vocabulary: [],
    });

    const parsed = parseFeedback(payload, learnerLines);
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0].fluencyUpgrade).toBeNull();
  });

  it("caps vocabulary at 5 and dedupes it case-insensitively", () => {
    const payload = JSON.stringify({
      items: [],
      vocabulary: [
        { item: "apple", meaning: "fruit", example: "Eat an apple." },
        { item: "APPLE", meaning: "same fruit uppercase", example: "Eat an APPLE." },
        { item: "banana", meaning: "fruit", example: "Eat a banana." },
        { item: "cherry", meaning: "fruit", example: "Eat a cherry." },
        { item: "date", meaning: "fruit", example: "Eat a date." },
        { item: "elderberry", meaning: "fruit", example: "Eat an elderberry." },
        { item: "fig", meaning: "fruit", example: "Eat a fig." },
      ],
    });

    const parsed = parseFeedback(payload, learnerLines);
    expect(parsed?.vocabulary).toHaveLength(MAX_VOCABULARY);
    expect(parsed?.vocabulary.map((v) => v.item)).toEqual([
      "apple",
      "banana",
      "cherry",
      "date",
      "elderberry",
    ]);
  });

  it("sorts items by line", () => {
    const payload = JSON.stringify({
      items: [
        {
          line: 3,
          edits: [{ original: "is engineer", correction: "is an engineer", code: "M:DET" }],
          explanation: "Add article an.",
        },
        {
          line: 1,
          edits: [{ original: "go", correction: "went", code: "R:VERB:TENSE" }],
          explanation: "Past tense.",
        },
      ],
      vocabulary: [],
    });

    const parsed = parseFeedback(payload, learnerLines);
    expect(parsed?.items.map((i) => i.line)).toEqual([1, 3]);
  });
});

describe("splitSentences", () => {
  it("splits multi-line text with varied sentence endings", () => {
    expect(splitSentences("Hi. How are you?\n\nI am fine!")).toEqual([
      "Hi.",
      "How are you?",
      "I am fine!",
    ]);
  });

  it("splits ellipses and question marks", () => {
    expect(splitSentences("Wait... really? Yes.")).toEqual(["Wait...", "really?", "Yes."]);
  });

  it("handles text without punctuation as one sentence", () => {
    expect(splitSentences("this is a line without punctuation")).toEqual([
      "this is a line without punctuation",
    ]);
  });

  it("handles quotes and closing brackets", () => {
    expect(
      splitSentences('He said, "Hello!" Then he walked away (quickly). Soon he arrived.'),
    ).toEqual(['He said, "Hello!"', "Then he walked away (quickly).", "Soon he arrived."]);
  });

  it("handles empty or whitespace-only text", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   \n\n  \t  ")).toEqual([]);
  });
});
