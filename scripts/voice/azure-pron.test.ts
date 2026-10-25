import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import { findPattern } from "../../lib/pronunciation-patterns.ts";
import {
  AZURE_TO_CATALOG,
  capabilities,
  catalogCoverage,
  computeWeightedScores,
  gateCheck,
  parseArgs,
  parseWav,
  pcmToWav,
  phonemeMismatches,
  resultLagMs,
  weakWords,
  type PhraseResult,
} from "./azure-pron.ts";

describe("parseWav", () => {
  it("parses a standard 44-byte-header WAV file", () => {
    const pcm = Buffer.alloc(3200, 0x12);
    const wav = pcmToWav(pcm, 16000);

    const parsed = parseWav(wav);
    expect(parsed.sampleRate).toBe(16000);
    expect(parsed.channels).toBe(1);
    expect(parsed.bitsPerSample).toBe(16);
    expect(parsed.pcm.length).toBe(3200);
    expect(parsed.pcm.equals(pcm)).toBe(true);
  });

  it("parses a file with an extra FLLR chunk before data", () => {
    const pcm = Buffer.alloc(1600, 0x34);
    const fillerSize = 48;

    // RIFF (12 bytes) + fmt (24 bytes) + FLLR (8 + 48 = 56 bytes) + data (8 + 1600 = 1608 bytes)
    const totalSize = 12 + 24 + (8 + fillerSize) + (8 + pcm.length);
    const buf = Buffer.alloc(totalSize);

    // RIFF header
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(totalSize - 8, 4);
    buf.write("WAVE", 8, "ascii");

    // fmt chunk
    buf.write("fmt ", 12, "ascii");
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20); // PCM
    buf.writeUInt16LE(1, 22); // mono
    buf.writeUInt32LE(16000, 24); // 16 kHz
    buf.writeUInt32LE(32000, 28); // byte rate
    buf.writeUInt16LE(2, 32); // block align
    buf.writeUInt16LE(16, 34); // 16-bit

    // FLLR chunk
    let offset = 36;
    buf.write("FLLR", offset, "ascii");
    buf.writeUInt32LE(fillerSize, offset + 4);
    offset += 8 + fillerSize;

    // data chunk
    buf.write("data", offset, "ascii");
    buf.writeUInt32LE(pcm.length, offset + 4);
    pcm.copy(buf, offset + 8);

    const parsed = parseWav(buf);
    expect(parsed.sampleRate).toBe(16000);
    expect(parsed.channels).toBe(1);
    expect(parsed.bitsPerSample).toBe(16);
    expect(parsed.pcm.length).toBe(1600);
    expect(parsed.pcm.equals(pcm)).toBe(true);
  });

  it("parses a WAVE_FORMAT_EXTENSIBLE header with a PCM SubFormat", () => {
    const pcm = Buffer.alloc(320, 0x56);
    const buf = Buffer.alloc(12 + 8 + 40 + 8 + pcm.length);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(buf.length - 8, 4);
    buf.write("WAVE", 8, "ascii");
    buf.write("fmt ", 12, "ascii");
    buf.writeUInt32LE(40, 16);
    buf.writeUInt16LE(0xfffe, 20); // WAVE_FORMAT_EXTENSIBLE
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(16000, 24);
    buf.writeUInt32LE(32000, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.writeUInt16LE(22, 36); // cbSize
    buf.writeUInt16LE(16, 38); // valid bits
    buf.writeUInt32LE(4, 40); // channel mask
    buf.writeUInt16LE(1, 44); // SubFormat GUID starts with PCM (1)
    buf.write("data", 60, "ascii");
    buf.writeUInt32LE(pcm.length, 64);
    pcm.copy(buf, 68);

    const parsed = parseWav(buf);
    expect(parsed.sampleRate).toBe(16000);
    expect(parsed.pcm.equals(pcm)).toBe(true);
  });

  it("throws with afconvert message when file is 44.1 kHz stereo", () => {
    const buf = Buffer.alloc(44);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(36, 4);
    buf.write("WAVE", 8, "ascii");
    buf.write("fmt ", 12, "ascii");
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20); // PCM
    buf.writeUInt16LE(2, 22); // Stereo (2 channels)
    buf.writeUInt32LE(44100, 24); // 44.1 kHz
    buf.writeUInt32LE(44100 * 4, 28);
    buf.writeUInt16LE(4, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36, "ascii");
    buf.writeUInt32LE(0, 40);

    expect(() => parseWav(buf)).toThrow(
      /afconvert -f WAVE -d LEI16@16000 -c 1 in\.m4a out\/azure-pron\/clips\/<name>\.wav/,
    );
  });

  it("throws with afconvert message on invalid or short files", () => {
    expect(() => parseWav(Buffer.alloc(8))).toThrow(/afconvert/);
    expect(() => parseWav(Buffer.from("NOT_A_VALID_RIFF_WAV_HEADER_AT_ALL"))).toThrow(/afconvert/);
  });
});

describe("gateCheck", () => {
  const twentyWords = (end: string) => Array(20).fill("word").join(" ") + end;
  const sixtyWordsThreeSentences = [twentyWords("."), twentyWords("?"), twentyWords("!")].join(" ");

  it("passes when audio is 25 s with 60 words in 3 sentences", () => {
    const res = gateCheck(25_000, sixtyWordsThreeSentences);
    expect(res.ok).toBe(true);
    expect(res.seconds).toBe(25);
    expect(res.words).toBe(60);
    expect(res.sentences).toBe(3);
  });

  it("fails when audio is 15 s (under 20 s threshold)", () => {
    const res = gateCheck(15_000, sixtyWordsThreeSentences);
    expect(res.ok).toBe(false);
    expect(res.seconds).toBe(15);
    expect(res.words).toBe(60);
    expect(res.sentences).toBe(3);
  });

  it("counts text without punctuation as 1 sentence", () => {
    const noPunctuation =
      "this is a sample sentence without any periods or question marks or exclamation marks";
    const res = gateCheck(25_000, noPunctuation);
    expect(res.sentences).toBe(1);
    expect(res.words).toBe(14);
    expect(res.ok).toBe(false); // only 14 words and 1 sentence
  });

  it("returns 0 words and 0 sentences on empty string", () => {
    const res = gateCheck(25_000, "   ");
    expect(res.words).toBe(0);
    expect(res.sentences).toBe(0);
    expect(res.ok).toBe(false);
  });
});

describe("result-reading helpers", () => {
  const fixture: PhraseResult[] = [
    {
      DisplayText: "Very good.",
      Offset: 0,
      Duration: 20_000_000, // 2000 ms
      NBest: [
        {
          PronunciationAssessment: {
            AccuracyScore: 50,
            FluencyScore: 80,
            ProsodyScore: 75,
            CompletenessScore: 100,
            PronScore: 68,
          },
          Words: [
            {
              Word: "very",
              PronunciationAssessment: {
                AccuracyScore: 45,
                ErrorType: "Mispronunciation",
                Feedback: {
                  Prosody: {
                    Break: { ErrorType: "None" },
                    Intonation: { ErrorType: "Monotone" },
                  },
                },
              },
              Syllables: [{ Syllable: "vɛ" }, { Syllable: "ɹi" }],
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
                {
                  Phoneme: "ɛ",
                  PronunciationAssessment: {
                    AccuracyScore: 90,
                    NBestPhonemes: [{ Phoneme: "ɛ", Score: 90 }],
                  },
                },
                {
                  Phoneme: "ɹ",
                  PronunciationAssessment: {
                    AccuracyScore: 42,
                    NBestPhonemes: [
                      { Phoneme: "l", Score: 80 },
                      { Phoneme: "ɹ", Score: 42 },
                    ],
                  },
                },
                {
                  Phoneme: "i",
                  PronunciationAssessment: {
                    AccuracyScore: 95,
                    NBestPhonemes: [{ Phoneme: "i", Score: 95 }],
                  },
                },
              ],
            },
            {
              Word: "good",
              PronunciationAssessment: {
                AccuracyScore: 92,
                ErrorType: "None",
              },
            },
          ],
        },
      ],
    },
  ];

  it("evaluates capabilities correctly from fixture", () => {
    const caps = capabilities(fixture);
    expect(caps.AccuracyScore).toBe(true);
    expect(caps.FluencyScore).toBe(true);
    expect(caps.ProsodyScore).toBe(true);
    expect(caps.CompletenessScore).toBe(true);
    expect(caps.PronScore).toBe(true);
    expect(caps["word.AccuracyScore"]).toBe(true);
    expect(caps["word.ErrorType"]).toBe(true);
    expect(caps["word.Feedback.Prosody.Break"]).toBe(true);
    expect(caps["word.Feedback.Prosody.Intonation"]).toBe(true);
    expect(caps["word.Syllables"]).toBe(true);
    expect(caps["word.Phonemes"]).toBe(true);
    expect(caps["phoneme.NBestPhonemes"]).toBe(true);
    expect(caps["ErrorType=Mispronunciation"]).toBe(true);
    expect(caps["ErrorType=None"]).toBe(true);
  });

  it("filters weakWords below threshold in order", () => {
    const weak = weakWords(fixture, 60);
    expect(weak).toEqual([
      {
        word: "very",
        score: 45,
        errorType: "Mispronunciation",
      },
    ]);
  });

  it("identifies phonemeMismatches where top NBest differs from expected", () => {
    const mismatches = phonemeMismatches(fixture, 60);
    expect(mismatches).toEqual([
      {
        word: "very",
        expected: "v",
        heard: "b",
        score: 40,
      },
      {
        word: "very",
        expected: "ɹ",
        heard: "l",
        score: 42,
      },
    ]);
  });

  it("aggregates catalogCoverage, mapping known pairs and checking catalog presence", () => {
    const mismatches = phonemeMismatches(fixture, 60);
    const coverage = catalogCoverage(mismatches);

    expect(coverage).toEqual([
      {
        code: "IPA:/v/_to_[b]",
        count: 1,
        inCatalog: true,
      },
      {
        code: "ɹ>l",
        count: 1,
        inCatalog: false,
      },
    ]);
  });
});

describe("AZURE_TO_CATALOG", () => {
  it("maps all predefined pairs to codes that exist in the catalog", () => {
    for (const [pair, code] of Object.entries(AZURE_TO_CATALOG)) {
      expect(pair).toMatch(/^.+>.+$/);
      const pattern = findPattern(code);
      expect(pattern).toBeDefined();
      expect(pattern?.code).toBe(code);
    }
  });
});

describe("resultLagMs", () => {
  const phrase: PhraseResult = {
    DisplayText: "test phrase",
    Offset: 0,
    Duration: 10_000_000, // 1000 ms of audio (10_000_000 * 100 ns)
    NBest: [],
  };

  it("computes lag at speed 1", () => {
    // pushStartMs = 1000. Last audio pushed at 1000 + 1000/1 = 2000 ms.
    // Event arrives at 2500 ms -> lag = 500 ms.
    const lag = resultLagMs(2500, 1000, phrase, 1);
    expect(lag).toBe(500);
  });

  it("computes lag at speed 4", () => {
    // pushStartMs = 1000. Last audio pushed at 1000 + 1000/4 = 1250 ms.
    // Event arrives at 1500 ms -> lag = 250 ms.
    const lag = resultLagMs(1500, 1000, phrase, 4);
    expect(lag).toBe(250);
  });

  it("clamps negative lag at 0 when jitter occurs", () => {
    // Event arrives at 1900 ms before nominal push end (2000 ms) -> lag clamped to 0.
    const lag = resultLagMs(1900, 1000, phrase, 1);
    expect(lag).toBe(0);
  });
});

describe("pcmToWav", () => {
  it("writes valid 44-byte WAV header and PCM data", () => {
    const sampleRate = 16000;
    const pcm = Buffer.from([0x10, 0x20, 0x30, 0x40]);
    const wav = pcmToWav(pcm, sampleRate);

    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.readUInt32LE(16)).toBe(16);
    expect(wav.readUInt16LE(20)).toBe(1); // PCM format
    expect(wav.readUInt16LE(22)).toBe(1); // Mono
    expect(wav.readUInt32LE(24)).toBe(sampleRate);
    expect(wav.readUInt32LE(28)).toBe(sampleRate * 2); // Byte rate
    expect(wav.readUInt16LE(32)).toBe(2); // Block align
    expect(wav.readUInt16LE(34)).toBe(16); // Bits per sample
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.subarray(44).equals(pcm)).toBe(true);
  });
});

describe("computeWeightedScores", () => {
  it("weights phrase scores by duration", () => {
    const phrases: PhraseResult[] = [
      {
        DisplayText: "p1",
        Offset: 0,
        Duration: 10_000_000, // 1s
        NBest: [{ PronunciationAssessment: { AccuracyScore: 80, FluencyScore: 90 } }],
      },
      {
        DisplayText: "p2",
        Offset: 10_000_000,
        Duration: 30_000_000, // 3s
        NBest: [{ PronunciationAssessment: { AccuracyScore: 60, FluencyScore: 70 } }],
      },
    ];

    const scores = computeWeightedScores(phrases);
    // AccuracyScore: (80 * 1 + 60 * 3) / 4 = 260 / 4 = 65
    expect(scores.AccuracyScore).toBe(65);
    // FluencyScore: (90 * 1 + 70 * 3) / 4 = 300 / 4 = 75
    expect(scores.FluencyScore).toBe(75);
  });
});

describe("parseArgs", () => {
  it("parses --synth, --fast, and clip paths", () => {
    expect(parseArgs([])).toEqual({ synth: false, fast: false, clips: [] });
    expect(parseArgs(["--synth"])).toEqual({ synth: true, fast: false, clips: [] });
    expect(parseArgs(["--fast", "clip1.wav", "clip2.wav"])).toEqual({
      synth: false,
      fast: true,
      clips: ["clip1.wav", "clip2.wav"],
    });
  });
});
