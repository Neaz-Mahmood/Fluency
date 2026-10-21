import { describe, expect, it } from "vitest";

import {
  buildSummaryInput,
  capSummary,
  estimateTokens,
  SUMMARY_MAX_CHARS,
  SUMMARY_PROMPT,
} from "@/lib/summary";

const CEFR_LEVELS = [null, "A1", "A2", "B1", "B2", "C1", "C2"] as const;
const NATIVE_LANGS = ["bn-BD", null] as const;

const SAMPLE_SENTENCE =
  "The learner practiced English today. They spoke about their job and hobbies! Can they improve? Yes, with practice. ";

function makeTextWithSentences(minChars: number): string {
  let text = "";
  while (text.length < minChars) {
    text += SAMPLE_SENTENCE;
  }
  return text.slice(0, minChars);
}

const NOTE_120_WORDS = Array.from({ length: 120 }, (_, i) =>
  i % 10 === 9 ? `word${i}.` : `word${i}`,
).join(" ");

const NOTE_2000_CHARS_WITH_SENTENCES = makeTextWithSentences(2000);

const NOTE_1500_CHARS_NO_PUNCTUATION =
  "learner practicing speaking without punctuation words flow steadily along the path "
    .repeat(25)
    .replace(/[^a-zA-Z ]/g, "")
    .slice(0, 1500);

describe("summary prompt", () => {
  it("defines the exact private tutor prompt", () => {
    expect(SUMMARY_PROMPT).toContain("You write a short private note about an English learner");
    expect(SUMMARY_PROMPT).toContain("Write plain text, at most 100 words, no lists, no markdown.");
  });
});

describe("estimateTokens", () => {
  it("estimates tokens conservatively using CHARS_PER_TOKEN_ESTIMATE", () => {
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("abcd")).toBe(2);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(700))).toBe(234);
    expect(estimateTokens("a".repeat(700))).toBeLessThan(250);
  });
});

describe("capSummary", () => {
  it("leaves short text unchanged", () => {
    const short = "Learner is B1. Needs work on past tense.";
    expect(capSummary(short)).toBe(short);
  });

  it("collapses whitespace and trims short text", () => {
    expect(capSummary("  Learner is B1.   Needs work.  \n ")).toBe("Learner is B1. Needs work.");
  });

  it("cuts at a sentence end", () => {
    const sentence = "The learner speaks clearly. ";
    const longText = sentence.repeat(30);
    const capped = capSummary(longText);

    expect(capped.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(capped.endsWith(".")).toBe(true);
    expect(capped.length).toBe(28 * 25 - 1);
  });

  it("recognizes exclamation marks and question marks as sentence ends", () => {
    const text = "Are they ready? Yes, they are! ".repeat(30);
    const capped = capSummary(text);

    expect(capped.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect([".", "!", "?"].some((char) => capped.endsWith(char))).toBe(true);
  });

  it("falls back to a space", () => {
    const words = "learner speaking practice continuous flow words words ".repeat(20);
    const noPunctuation = words.replace(/[^a-zA-Z ]/g, "");
    expect(noPunctuation.length).toBeGreaterThan(SUMMARY_MAX_CHARS);

    const capped = capSummary(noPunctuation);
    expect(capped.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(/[.!?]/.test(capped)).toBe(false);
    expect(capped.endsWith(" ")).toBe(false);
    expect(noPunctuation.startsWith(capped)).toBe(true);
  });
});

describe("buildSummaryInput", () => {
  it("includes level, native language, previous note and both speakers", () => {
    const input = buildSummaryInput(
      {
        cefrSpeaking: "B2",
        nativeLanguage: "bn-BD",
        compactTutorSummary: "Learner loves talking about technology.",
      },
      [
        { role: "user", content: "I work as a software engineer." },
        { role: "assistant", content: "That sounds exciting! What kind of software?" },
      ],
    );

    expect(input).toContain("Level: B2");
    expect(input).toContain("Native language: bn-BD");
    expect(input).toContain("Previous note:\nLearner loves talking about technology.");
    expect(input).toContain(
      "Transcript:\nLearner: I work as a software engineer.\nPartner: That sounds exciting! What kind of software?",
    );
  });

  it("uses fallback placeholders when fields are null or empty", () => {
    const input = buildSummaryInput(
      {
        cefrSpeaking: null,
        nativeLanguage: null,
        compactTutorSummary: "   ",
      },
      [{ role: "user", content: "Hello." }],
    );

    expect(input).toContain("Level: unknown");
    expect(input).toContain("Native language: unknown");
    expect(input).toContain("Previous note:\n(none)");
    expect(input).toContain("Transcript:\nLearner: Hello.");
  });
});

describe("FLU-31 20 test profiles check", () => {
  it("keeps summary under 250 tokens and non-empty across 20 test profiles", () => {
    const profiles = Array.from({ length: 20 }, (_, i) => {
      // 14 combinations of 7 CEFR levels × 2 native languages, cycling to 20 profiles
      const cefrSpeaking = CEFR_LEVELS[i % CEFR_LEVELS.length];
      const nativeLanguage = NATIVE_LANGS[i % NATIVE_LANGS.length];
      const noteLen = Math.round((i / 19) * 3000);
      const compactTutorSummary = noteLen === 0 ? "" : makeTextWithSentences(noteLen);
      const turnCount = 1 + Math.round((i / 19) * 39);
      const turns = Array.from({ length: turnCount }, (__, turnIdx) => ({
        role: turnIdx % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `Turn ${turnIdx + 1} content about daily practice.`,
      }));

      return {
        profile: { cefrSpeaking, nativeLanguage, compactTutorSummary },
        turns,
      };
    });

    expect(profiles).toHaveLength(20);

    // Verify all 7 CEFR levels (and null) are covered
    const seenLevels = new Set(profiles.map((p) => p.profile.cefrSpeaking));
    expect(seenLevels.size).toBe(CEFR_LEVELS.length);

    // Verify both native languages are covered
    const seenLangs = new Set(profiles.map((p) => p.profile.nativeLanguage));
    expect(seenLangs.size).toBe(NATIVE_LANGS.length);

    // Verify note lengths range from 0 to 3000
    expect(profiles[0].profile.compactTutorSummary.length).toBe(0);
    expect(profiles[19].profile.compactTutorSummary.length).toBe(3000);

    // Verify turns range from 1 to 40
    expect(profiles[0].turns.length).toBe(1);
    expect(profiles[19].turns.length).toBe(40);

    profiles.forEach(({ profile, turns }, i) => {
      const summaryInput = buildSummaryInput(profile, turns);
      expect(summaryInput).toContain("Level:");
      expect(summaryInput).toContain("Native language:");
      expect(summaryInput).toContain("Previous note:");
      expect(summaryInput).toContain("Transcript:");

      // Cycle through the four fake model outputs
      let fakeOutput: string;
      const cycle = i % 4;
      if (cycle === 0) {
        fakeOutput = NOTE_120_WORDS;
      } else if (cycle === 1) {
        fakeOutput = NOTE_2000_CHARS_WITH_SENTENCES;
      } else if (cycle === 2) {
        fakeOutput = NOTE_1500_CHARS_NO_PUNCTUATION;
      } else {
        fakeOutput = (profile.compactTutorSummary + " ").repeat(2).trim();
      }

      const capped = capSummary(fakeOutput);
      expect(capped.length).toBeGreaterThan(0);
      expect(capped.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
      expect(estimateTokens(capped)).toBeLessThan(250);
    });
  });
});
