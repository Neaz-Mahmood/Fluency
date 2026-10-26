import { describe, expect, it } from "vitest";

import { summarizePhrases, type PhraseResult } from "./pronunciation-score.ts";

describe("summarizePhrases", () => {
  it("summarizes a single phrase with all scores, weak words, and mismatches", () => {
    const phrase: PhraseResult = {
      DisplayText: "I visited the zoo.",
      Offset: 0,
      Duration: 10_000_000,
      NBest: [
        {
          PronunciationAssessment: {
            AccuracyScore: 82.3,
            FluencyScore: 78.4,
            ProsodyScore: 88.0,
            CompletenessScore: 100.0,
            PronScore: 84.6,
          },
          Words: [
            {
              Word: "visited",
              PronunciationAssessment: {
                AccuracyScore: 50,
                ErrorType: "Mispronunciation",
              },
              Phonemes: [
                {
                  Phoneme: "v",
                  PronunciationAssessment: {
                    AccuracyScore: 40,
                    NBestPhonemes: [
                      { Phoneme: "b", Score: 85 },
                      { Phoneme: "v", Score: 40 },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const result = summarizePhrases([phrase]);
    expect(result).toEqual({
      accuracy: 82.3,
      fluency: 78.4,
      prosody: 88.0,
      completeness: 100.0,
      pronScore: 84.6,
      weakWords: [
        {
          word: "visited",
          score: 50,
          errorType: "Mispronunciation",
        },
      ],
      mismatches: [
        {
          word: "visited",
          expected: "v",
          heard: "b",
          score: 40,
        },
      ],
    });
  });

  it("weights multiple phrases by duration and rounds to one decimal place", () => {
    // Phrase 1: duration 1000, accuracy 80
    // Phrase 2: duration 2000, accuracy 87
    // Weighted mean: (80 * 1000 + 87 * 2000) / 3000 = 254000 / 3000 = 84.666... -> 84.7
    const phrases: PhraseResult[] = [
      {
        DisplayText: "First part",
        Offset: 0,
        Duration: 1000,
        NBest: [
          {
            PronunciationAssessment: {
              AccuracyScore: 80,
              FluencyScore: 70,
              ProsodyScore: 60,
              CompletenessScore: 90,
              PronScore: 75,
            },
          },
        ],
      },
      {
        DisplayText: "Second part",
        Offset: 1000,
        Duration: 2000,
        NBest: [
          {
            PronunciationAssessment: {
              AccuracyScore: 87,
              FluencyScore: 85,
              ProsodyScore: 88,
              CompletenessScore: 95,
              PronScore: 89,
            },
          },
        ],
      },
    ];

    const result = summarizePhrases(phrases);
    expect(result.accuracy).toBe(84.7);
    expect(result.fluency).toBe(80.0);
    expect(result.prosody).toBe(78.7);
    expect(result.completeness).toBe(93.3);
    expect(result.pronScore).toBe(84.3);
  });

  it("handles a phrase missing ProsodyScore by taking the mean over the phrases that have it", () => {
    const phrases: PhraseResult[] = [
      {
        DisplayText: "Has prosody",
        Offset: 0,
        Duration: 1000,
        NBest: [
          {
            PronunciationAssessment: {
              AccuracyScore: 80,
              ProsodyScore: 90,
            },
          },
        ],
      },
      {
        DisplayText: "Missing prosody",
        Offset: 1000,
        Duration: 2000,
        NBest: [
          {
            PronunciationAssessment: {
              AccuracyScore: 90,
            },
          },
        ],
      },
    ];

    const result = summarizePhrases(phrases);
    // Accuracy uses both: (80 * 1000 + 90 * 2000) / 3000 = 86.7
    expect(result.accuracy).toBe(86.7);
    // Prosody uses only phrase 1: 90
    expect(result.prosody).toBe(90.0);
    // The others are missing in all phrases -> null
    expect(result.fluency).toBeNull();
    expect(result.completeness).toBeNull();
    expect(result.pronScore).toBeNull();
  });

  it("returns all nulls and empty arrays when given no phrases", () => {
    const result = summarizePhrases([]);
    expect(result).toEqual({
      accuracy: null,
      fluency: null,
      prosody: null,
      completeness: null,
      pronScore: null,
      weakWords: [],
      mismatches: [],
    });
  });

  it("passes through weakWords and mismatches from the moved functions", () => {
    const phrases: PhraseResult[] = [
      {
        DisplayText: "She drank some tea.",
        Offset: 0,
        Duration: 5000,
        NBest: [
          {
            PronunciationAssessment: { AccuracyScore: 70 },
            Words: [
              {
                Word: "drank",
                PronunciationAssessment: { AccuracyScore: 45, ErrorType: "Mispronunciation" },
                Phonemes: [
                  {
                    Phoneme: "d",
                    PronunciationAssessment: {
                      AccuracyScore: 35,
                      NBestPhonemes: [
                        { Phoneme: "t", Score: 80 },
                        { Phoneme: "d", Score: 35 },
                      ],
                    },
                  },
                ],
              },
              {
                Word: "tea",
                PronunciationAssessment: { AccuracyScore: 85, ErrorType: "None" },
              },
            ],
          },
        ],
      },
    ];

    const result = summarizePhrases(phrases);
    expect(result.weakWords).toEqual([
      {
        word: "drank",
        score: 45,
        errorType: "Mispronunciation",
      },
    ]);
    expect(result.mismatches).toEqual([
      {
        word: "drank",
        expected: "d",
        heard: "t",
        score: 35,
      },
    ]);
  });
});
