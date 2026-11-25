import { describe, expect, it } from "vitest";

import {
  BLANK,
  blankSentence,
  buildReviewInput,
  maskItem,
  parseReviewSentence,
  REVIEW_SENTENCE_PROMPT,
} from "@/lib/review";

describe("REVIEW_SENTENCE_PROMPT", () => {
  it("has the expected prompt text", () => {
    expect(REVIEW_SENTENCE_PROMPT).toContain(
      "You write one new practice sentence for an English learner's flashcard review.",
    );
    expect(REVIEW_SENTENCE_PROMPT).toContain(
      'Return only a JSON object, no other text: {"sentence": "..."}',
    );
  });
});

describe("buildReviewInput", () => {
  it("formats input with context sentence and learner level", () => {
    const input = buildReviewInput(
      {
        targetItem: "went",
        nativeTranslation: "গিয়েছিলাম",
        sourceContextSentence: "I went to the store yesterday.",
      },
      "B1",
    );

    expect(input).toBe(
      "Target item: went\nMeaning: গিয়েছিলাম\nExample sentence: I went to the store yesterday.\nLearner level: B1",
    );
  });

  it("formats input without context sentence and without level", () => {
    const input = buildReviewInput(
      {
        targetItem: "went",
        nativeTranslation: "গিয়েছিলাম",
        sourceContextSentence: null,
      },
      null,
    );

    expect(input).toBe(
      "Target item: went\nMeaning: গিয়েছিলাম\nExample sentence: (none)\nLearner level: unknown",
    );
  });
});

describe("blankSentence", () => {
  it("replaces target item case-insensitively", () => {
    expect(blankSentence("Yesterday I Went to the store.", "went")).toBe(
      `Yesterday I ${BLANK} to the store.`,
    );
    expect(blankSentence("WENT to school.", "went")).toBe(`${BLANK} to school.`);
    expect(blankSentence("i went to school.", "WENT")).toBe(`i ${BLANK} to school.`);
  });

  it("replaces only the first occurrence", () => {
    expect(blankSentence("She went home and then went to sleep.", "went")).toBe(
      `She ${BLANK} home and then went to sleep.`,
    );
  });

  it("ignores punctuation and ellipses around the item", () => {
    expect(blankSentence("Could I have a cup of tea?", "Could I have...?")).toBe(
      "_____ a cup of tea?",
    );
  });

  it("returns null when the item is missing", () => {
    expect(blankSentence("I walked to school.", "went")).toBeNull();
  });

  it("returns null when targetItem.trim() is empty", () => {
    expect(blankSentence("I walked to school.", "")).toBeNull();
    expect(blankSentence("I walked to school.", "   ")).toBeNull();
  });
});

describe("maskItem", () => {
  it("masks every occurrence, case-insensitively", () => {
    expect(maskItem("'like' … তাই 'I like'", "like")).toBe(`'${BLANK}' … তাই 'I ${BLANK}'`);
  });

  it("leaves the text unchanged when the item doesn't occur", () => {
    expect(maskItem("I walked to school.", "went")).toBe("I walked to school.");
  });

  it("handles an item with regex characters and edge punctuation", () => {
    expect(maskItem("Say could I have politely.", "Could I have...?")).toBe(
      `Say ${BLANK} politely.`,
    );
  });

  it("leaves the text unchanged when the stripped item is empty", () => {
    expect(maskItem("Say could I have politely.", "")).toBe("Say could I have politely.");
    expect(maskItem("Say could I have politely.", "   ")).toBe("Say could I have politely.");
    expect(maskItem("Say could I have politely.", "...")).toBe("Say could I have politely.");
  });
});

describe("parseReviewSentence", () => {
  it("parses a fenced reply with ```json fence", () => {
    const text = '```json\n{"sentence": "She went to the market."}\n```';
    expect(parseReviewSentence(text, "went")).toBe(`She ${BLANK} to the market.`);
  });

  it("parses a fenced reply with ``` fence", () => {
    const text = '```\n{"sentence": "She went to the market."}\n```';
    expect(parseReviewSentence(text, "went")).toBe(`She ${BLANK} to the market.`);
  });

  it("parses a good reply and gives the cloze", () => {
    const text = '{"sentence": "She went to the market."}';
    expect(parseReviewSentence(text, "went")).toBe(`She ${BLANK} to the market.`);
  });

  it("returns null for non-JSON", () => {
    expect(parseReviewSentence("not json at all", "went")).toBeNull();
    expect(parseReviewSentence("```json\n{broken json\n```", "went")).toBeNull();
    expect(parseReviewSentence("[]", "went")).toBeNull();
    expect(parseReviewSentence("123", "went")).toBeNull();
    expect(parseReviewSentence('{"other": "field"}', "went")).toBeNull();
    expect(parseReviewSentence('{"sentence": 123}', "went")).toBeNull();
    expect(parseReviewSentence('{"sentence": ""}', "went")).toBeNull();
    expect(parseReviewSentence('{"sentence": "   "}', "went")).toBeNull();
  });

  it("returns null when sentence does not contain the target item", () => {
    const text = '{"sentence": "She walked to the market."}';
    expect(parseReviewSentence(text, "went")).toBeNull();
  });

  it("returns null for an over-long sentence (> 300 characters)", () => {
    const longSentence = "went " + "a".repeat(298); // 5 + 298 = 303 characters
    expect(parseReviewSentence(JSON.stringify({ sentence: longSentence }), "went")).toBeNull();

    const maxAllowed = "went " + "a".repeat(295); // 5 + 295 = 300 characters
    expect(parseReviewSentence(JSON.stringify({ sentence: maxAllowed }), "went")).toBe(
      `${BLANK} ` + "a".repeat(295),
    );
  });
});
