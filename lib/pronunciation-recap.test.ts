import { describe, expect, it } from "vitest";

import {
  buildTipsInput,
  buildTipsSystemPrompt,
  isLikelyProperNoun,
  parseTips,
  summarizeSessionPronunciation,
  tipFocuses,
  waitForSettledCount,
  type ScoredTurn,
  type SessionPronunciation,
} from "@/lib/pronunciation-recap";

describe("isLikelyProperNoun", () => {
  it("recognizes a capitalized word inside a sentence as a likely proper noun", () => {
    expect(isLikelyProperNoun("Mirpur", "We went to Mirpur.")).toBe(true);
  });

  it("returns false for a capitalized word appearing only at sentence start", () => {
    expect(isLikelyProperNoun("Coffee", "Coffee is good.")).toBe(false);
  });

  it("returns false for a word that appears lowercase", () => {
    expect(isLikelyProperNoun("very", "It was very busy.")).toBe(false);
  });

  it("returns false for pronoun 'I'", () => {
    expect(isLikelyProperNoun("I", "I went to the zoo and I had fun.")).toBe(false);
  });

  it("returns false if any occurrence is lowercase", () => {
    expect(isLikelyProperNoun("Mirpur", "We went to Mirpur and later visited mirpur.")).toBe(false);
    expect(isLikelyProperNoun("mirpur", "We went to Mirpur and later visited mirpur.")).toBe(false);
  });

  it("returns false if word never occurs", () => {
    expect(isLikelyProperNoun("Dhaka", "We went to Mirpur.")).toBe(false);
  });
});

describe("summarizeSessionPronunciation", () => {
  it("returns empty summary for empty turns list", () => {
    const summary = summarizeSessionPronunciation([]);
    expect(summary).toEqual({
      scoredTurns: 0,
      audioMs: 0,
      accuracy: null,
      fluency: null,
      prosody: null,
      patterns: [],
      weakWords: [],
    });
  });

  it("computes audio-weighted means with null score on one turn", () => {
    const turns: ScoredTurn[] = [
      {
        audioMs: 1000,
        accuracy: 80,
        fluency: 70,
        prosody: null,
        weakWords: [],
        mismatches: [],
        transcript: "Hello there.",
      },
      {
        audioMs: 3000,
        accuracy: 60,
        fluency: null,
        prosody: 90,
        weakWords: [],
        mismatches: [],
        transcript: "How are you?",
      },
    ];

    const summary = summarizeSessionPronunciation(turns);
    expect(summary.scoredTurns).toBe(2);
    expect(summary.audioMs).toBe(4000);
    // accuracy: (80*1000 + 60*3000) / 4000 = (80000 + 180000) / 4000 = 65
    expect(summary.accuracy).toBe(65);
    // fluency: (70*1000) / 1000 = 70
    expect(summary.fluency).toBe(70);
    // prosody: (90*3000) / 3000 = 90
    expect(summary.prosody).toBe(90);
  });

  it("groups, counts, and sorts patterns; skips unmapped pairs and drops proper nouns", () => {
    const turns: ScoredTurn[] = [
      {
        audioMs: 2000,
        accuracy: 70,
        fluency: 60,
        prosody: 50,
        weakWords: [
          { word: "Mirpur", score: 40, errorType: "Mispronunciation" },
          { word: "very", score: 45, errorType: "Mispronunciation" },
        ],
        mismatches: [
          // Known pattern: IPA:/v/_to_[b] (v>b)
          { word: "very", expected: "v", heard: "b", score: 40 },
          // Proper noun mismatch: should be dropped
          { word: "Mirpur", expected: "p", heard: "b", score: 35 },
          // Unmapped pair: should be skipped
          { word: "red", expected: "ɹ", heard: "l", score: 30 },
        ],
        transcript: "We visited Mirpur. It was very busy.",
      },
      {
        audioMs: 2000,
        accuracy: 75,
        fluency: 65,
        prosody: 55,
        weakWords: [
          { word: "Very", score: 50, errorType: "Mispronunciation" },
          { word: "seven", score: 48, errorType: "Mispronunciation" },
        ],
        mismatches: [
          // Second mismatch for IPA:/v/_to_[b]
          { word: "seven", expected: "v", heard: "b", score: 50 },
          // Mismatch for IPA:/w/_to_[v] (w>v)
          { word: "west", expected: "w", heard: "v", score: 30 },
          { word: "wine", expected: "w", heard: "v", score: 30 },
        ],
        transcript: "We saw seven swans in the west with wine.",
      },
    ];

    const summary = summarizeSessionPronunciation(turns);

    // Both IPA:/v/_to_[b] and IPA:/w/_to_[v] have count 2.
    // IPA:/w/_to_[v] meanScore is 30, IPA:/v/_to_[b] meanScore is 45.
    // Ties are sorted by lower meanScore first!
    expect(summary.patterns).toEqual([
      {
        code: "IPA:/w/_to_[v]",
        count: 2,
        words: ["west", "wine"],
        meanScore: 30,
      },
      {
        code: "IPA:/v/_to_[b]",
        count: 2,
        words: ["very", "seven"],
        meanScore: 45,
      },
    ]);

    // Weak words: "Mirpur" dropped, "very" merged (scores 45 and 50 -> 45), "seven" 48
    expect(summary.weakWords).toEqual([
      { word: "very", score: 45 },
      { word: "seven", score: 48 },
    ]);
  });

  it("merges weak words by lowercase, keeps lowest, sorts lowest first, and caps at 8", () => {
    const turns: ScoredTurn[] = [
      {
        audioMs: 1000,
        accuracy: null,
        fluency: null,
        prosody: null,
        weakWords: [
          { word: "Apple", score: 55, errorType: "Mispronunciation" },
          { word: "apple", score: 50, errorType: "Mispronunciation" },
          { word: "banana", score: 42, errorType: "Mispronunciation" },
          { word: "cherry", score: 44, errorType: "Mispronunciation" },
          { word: "date", score: 30, errorType: "Mispronunciation" },
          { word: "elderberry", score: 35, errorType: "Mispronunciation" },
          { word: "fig", score: 48, errorType: "Mispronunciation" },
          { word: "grape", score: 52, errorType: "Mispronunciation" },
          { word: "honeydew", score: 59, errorType: "Mispronunciation" },
          { word: "kiwi", score: 25, errorType: "Mispronunciation" },
        ],
        mismatches: [],
        transcript: "The fruit list.",
      },
    ];

    const summary = summarizeSessionPronunciation(turns);
    expect(summary.weakWords).toHaveLength(8);
    // lowest score first:
    // kiwi (25), date (30), elderberry (35), banana (42), cherry (44), fig (48), apple (min 50), grape (52)
    expect(summary.weakWords).toEqual([
      { word: "kiwi", score: 25 },
      { word: "date", score: 30 },
      { word: "elderberry", score: 35 },
      { word: "banana", score: 42 },
      { word: "cherry", score: 44 },
      { word: "fig", score: 48 },
      { word: "apple", score: 50 },
      { word: "grape", score: 52 },
    ]);
  });
});

describe("tipFocuses", () => {
  it("includes patterns and weak words, and respects fluency / prosody < 60 threshold", () => {
    const summary: SessionPronunciation = {
      scoredTurns: 1,
      audioMs: 1000,
      accuracy: 75,
      fluency: 59,
      prosody: 60,
      patterns: [{ code: "IPA:/v/_to_[b]", count: 1, words: ["very"], meanScore: 50 }],
      weakWords: [{ word: "coffee", score: 42 }],
    };

    const focuses = tipFocuses(summary);
    expect(focuses.has("IPA:/v/_to_[b]")).toBe(true);
    expect(focuses.has("coffee")).toBe(true);
    expect(focuses.has("fluency")).toBe(true); // 59 < 60
    expect(focuses.has("prosody")).toBe(false); // 60 is not < 60
  });

  it("handles null fluency and prosody correctly", () => {
    const summary: SessionPronunciation = {
      scoredTurns: 1,
      audioMs: 1000,
      accuracy: null,
      fluency: null,
      prosody: null,
      patterns: [],
      weakWords: [],
    };

    const focuses = tipFocuses(summary);
    expect(focuses.size).toBe(0);
  });
});

describe("buildTipsPrompt and buildTipsInput", () => {
  it("interpolates language into PRONUNCIATION_TIPS_PROMPT", () => {
    const prompt = buildTipsSystemPrompt("Bangla");
    expect(prompt).toContain("Write in Bangla.");
    expect(prompt).not.toContain("{language}");
  });

  it("matches the exact example format from spec", () => {
    const summary: SessionPronunciation = {
      scoredTurns: 2,
      audioMs: 3000,
      accuracy: 75,
      fluency: 71,
      prosody: 55,
      patterns: [
        {
          code: "IPA:/v/_to_[b]",
          count: 2,
          words: ["very", "seven"],
          meanScore: 45,
        },
      ],
      weakWords: [{ word: "coffee", score: 42 }],
    };

    const input = buildTipsInput(summary);
    const expected = [
      "Sound patterns:",
      "- IPA:/v/_to_[b] | the sound /v/ sounded like [b] or [bʱ] | learner's words: very, seven | reference tip: Touch your top teeth to your bottom lip and let your voice buzz: 'very', not 'bhery'.",
      "Low-scoring words:",
      "- coffee (42)",
      "Scores: fluency 71, rhythm and intonation 55",
      'May use focus "prosody".',
    ].join("\n");

    expect(input).toBe(expected);
  });

  it("writes (none) for empty lists and handles allowed score focuses", () => {
    const summary: SessionPronunciation = {
      scoredTurns: 0,
      audioMs: 0,
      accuracy: null,
      fluency: 50,
      prosody: 52,
      patterns: [],
      weakWords: [],
    };

    const input = buildTipsInput(summary);
    const expected = [
      "Sound patterns:",
      "(none)",
      "Low-scoring words:",
      "(none)",
      "Scores: fluency 50, rhythm and intonation 52",
      'May use focus "fluency", "prosody".',
    ].join("\n");

    expect(input).toBe(expected);
  });

  it("omits Scores and May use focus when no scores are available or allowed", () => {
    const summary: SessionPronunciation = {
      scoredTurns: 1,
      audioMs: 1000,
      accuracy: 80,
      fluency: 85,
      prosody: 90,
      patterns: [],
      weakWords: [],
    };

    const input = buildTipsInput(summary);
    const expected = [
      "Sound patterns:",
      "(none)",
      "Low-scoring words:",
      "(none)",
      "Scores: fluency 85, rhythm and intonation 90",
    ].join("\n");

    expect(input).toBe(expected);
  });
});

describe("parseTips", () => {
  const allowed = new Set(["IPA:/v/_to_[b]", "coffee", "prosody"]);

  it("parses fenced JSON with valid tips", () => {
    const text =
      '```json\n{"tips":[{"focus":"IPA:/v/_to_[b]","tip":"Keep your top teeth on bottom lip."}]}\n```';
    const tips = parseTips(text, allowed);
    expect(tips).toEqual([{ focus: "IPA:/v/_to_[b]", tip: "Keep your top teeth on bottom lip." }]);
  });

  it("drops disallowed focuses and normalizes case-insensitively to canonical focus", () => {
    const text = JSON.stringify({
      tips: [
        { focus: "ipa:/v/_to_[b]", tip: "Tip 1." },
        { focus: "disallowed_focus", tip: "Tip 2." },
        { focus: "COFFEE", tip: "Tip 3." },
      ],
    });
    const tips = parseTips(text, allowed);
    expect(tips).toEqual([
      { focus: "IPA:/v/_to_[b]", tip: "Tip 1." },
      { focus: "coffee", tip: "Tip 3." },
    ]);
  });

  it("drops tips longer than 300 characters", () => {
    const text = JSON.stringify({
      tips: [
        { focus: "coffee", tip: "A".repeat(301) },
        { focus: "prosody", tip: "Valid short tip." },
      ],
    });
    const tips = parseTips(text, allowed);
    expect(tips).toEqual([{ focus: "prosody", tip: "Valid short tip." }]);
  });

  it("drops repeated focuses and keeps at most 3 tips", () => {
    const allowedMore = new Set(["focus1", "focus2", "focus3", "focus4"]);
    const text = JSON.stringify({
      tips: [
        { focus: "focus1", tip: "Tip 1" },
        { focus: "focus1", tip: "Duplicate tip 1" },
        { focus: "focus2", tip: "Tip 2" },
        { focus: "focus3", tip: "Tip 3" },
        { focus: "focus4", tip: "Tip 4" },
      ],
    });
    const tips = parseTips(text, allowedMore);
    expect(tips).toEqual([
      { focus: "focus1", tip: "Tip 1" },
      { focus: "focus2", tip: "Tip 2" },
      { focus: "focus3", tip: "Tip 3" },
    ]);
  });

  it("returns null for garbage or missing tips array", () => {
    expect(parseTips("Not JSON at all", allowed)).toBeNull();
    expect(parseTips("[]", allowed)).toBeNull();
    expect(parseTips('{"items":[]}', allowed)).toBeNull();
  });
});

describe("waitForSettledCount", () => {
  it("counts 0,0,0,0 and returns 0 after the settle time", async () => {
    const counts = [0, 0, 0, 0];
    let idx = 0;
    let sleepCalls = 0;

    const result = await waitForSettledCount(async () => counts[idx++] ?? 0, {
      intervalMs: 2000,
      settleMs: 6000,
      maxMs: 40000,
      sleep: async () => {
        sleepCalls++;
      },
    });

    expect(result).toBe(0);
    // 1 initial read + 3 interval reads (3 * 2000 = 6000 ms settle time)
    expect(idx).toBe(4);
    expect(sleepCalls).toBe(3);
  });

  it("counts 1,2,2,2,2 and returns 2 after it settles", async () => {
    const counts = [1, 2, 2, 2, 2];
    let idx = 0;

    const result = await waitForSettledCount(async () => counts[idx++] ?? 2, {
      intervalMs: 2000,
      settleMs: 6000,
      maxMs: 40000,
      sleep: async () => {},
    });

    expect(result).toBe(2);
    // Initial read (1), read 2 (diff -> reset), read 2 (2000), read 2 (4000), read 2 (6000 -> settle)
    expect(idx).toBe(5);
  });

  it("stops at maxMs for an ever-growing count", async () => {
    let count = 0;
    let sleepCalls = 0;

    const result = await waitForSettledCount(async () => ++count, {
      intervalMs: 2000,
      settleMs: 6000,
      maxMs: 10000,
      sleep: async () => {
        sleepCalls++;
      },
    });

    // Initial read: 1 (total 0)
    // sleep 1: total 2000, read 2
    // sleep 2: total 4000, read 3
    // sleep 3: total 6000, read 4
    // sleep 4: total 8000, read 5
    // sleep 5: total 10000, read 6 -> totalElapsedMs reaches maxMs 10000
    expect(sleepCalls).toBe(5);
    expect(result).toBe(6);
  });
});
