import { describe, expect, it } from "vitest";

import {
  analyze,
  formatTable,
  leadingSilenceMs,
  measure,
  parseArgs,
  pcmToWav,
  slug,
  summarize,
  toInt16,
  type Analysis,
  type Candidate,
  type Chunk,
  type Row,
  type Synth,
  SENTENCES,
} from "./tts-ab.ts";

describe("toInt16", () => {
  it("converts an even byte array without carry", () => {
    // Little-endian: [0x00, 0x01] -> 256, [0x02, 0x03] -> 770
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const { samples, carry } = toInt16(bytes, null);
    expect(carry).toBeNull();
    expect(samples).toHaveLength(2);
    expect(samples[0]).toBe(256);
    expect(samples[1]).toBe(770);
  });

  it("handles an odd byte array and prepends carry on the next call", () => {
    // First call: 3 bytes [0x01, 0x02, 0x03]
    // Sample 0: [0x01, 0x02] -> 513
    // Carry: [0x03]
    const { samples: s1, carry: c1 } = toInt16(new Uint8Array([0x01, 0x02, 0x03]), null);
    expect(s1).toHaveLength(1);
    expect(s1[0]).toBe(513);
    expect(c1).toEqual(new Uint8Array([0x03]));

    // Second call: 2 bytes [0x04, 0x05] with carry [0x03]
    // Combined: [0x03, 0x04, 0x05]
    // Sample 1: [0x03, 0x04] -> 1027
    // Carry: [0x05]
    const { samples: s2, carry: c2 } = toInt16(new Uint8Array([0x04, 0x05]), c1);
    expect(s2).toHaveLength(1);
    expect(s2[0]).toBe(1027);
    expect(c2).toEqual(new Uint8Array([0x05]));

    // Third call: 1 byte [0x06] with carry [0x05]
    // Combined: [0x05, 0x06] -> 1541
    // Carry: null
    const { samples: s3, carry: c3 } = toInt16(new Uint8Array([0x06]), c2);
    expect(s3).toHaveLength(1);
    expect(s3[0]).toBe(1541);
    expect(c3).toBeNull();
  });

  it("correctly converts negative samples in little-endian format", () => {
    // -1 is 0xFFFF -> [0xFF, 0xFF]
    // -32768 is 0x8000 -> [0x00, 0x80]
    // -1234 is 0xFB2E -> [0x2E, 0xFB]
    const bytes = new Uint8Array([0xff, 0xff, 0x00, 0x80, 0x2e, 0xfb]);
    const { samples, carry } = toInt16(bytes, null);
    expect(carry).toBeNull();
    expect(samples).toHaveLength(3);
    expect(samples[0]).toBe(-1);
    expect(samples[1]).toBe(-32768);
    expect(samples[2]).toBe(-1234);
  });
});

describe("leadingSilenceMs", () => {
  it("gives 100 ms (±10) for 100 ms of zeros then a 440 Hz sine at amplitude 8000", () => {
    const sampleRate = 24_000;
    const silenceSamples = (sampleRate * 100) / 1000; // 2400 samples = 100 ms
    const sineSamples = 2400; // 100 ms
    const pcm = new Int16Array(silenceSamples + sineSamples);

    for (let i = 0; i < sineSamples; i++) {
      pcm[silenceSamples + i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    }

    const silenceMs = leadingSilenceMs(pcm, sampleRate);
    expect(Math.abs(silenceMs - 100)).toBeLessThanOrEqual(10);
  });

  it("returns the full duration when audio is all zeros", () => {
    const sampleRate = 24_000;
    const pcm = new Int16Array(2400); // 100 ms of zeros
    expect(leadingSilenceMs(pcm, sampleRate)).toBe(100);
  });

  it("counts low noise at amplitude 50 as silence", () => {
    const sampleRate = 24_000;
    const pcm = new Int16Array(2400).fill(50); // 100 ms of amplitude 50
    expect(leadingSilenceMs(pcm, sampleRate)).toBe(100);
  });
});

describe("analyze", () => {
  it("calculates perceivedMs as 400 when first chunk is silence at 100 ms and second is audible at 400 ms", () => {
    const sampleRate = 24_000;
    // Chunk 1: 100 ms of silence (2400 zeros) arriving at 100 ms
    const chunk1: Chunk = {
      atMs: 100,
      pcm: new Int16Array(2400),
    };

    // Chunk 2: 100 ms of 440 Hz sine at amp 8000 arriving at 400 ms
    const chunk2Pcm = new Int16Array(2400);
    for (let i = 0; i < 2400; i++) {
      chunk2Pcm[i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    }
    const chunk2: Chunk = {
      atMs: 400,
      pcm: chunk2Pcm,
    };

    const result = analyze([chunk1, chunk2], sampleRate, 500);
    expect(result.firstAudioMs).toBe(100);
    expect(result.leadingSilenceMs).toBeCloseTo(100, 0);
    expect(result.audioMs).toBeCloseTo(200, 0);
    expect(result.totalMs).toBe(500);
    // perceivedMs must be 400, NOT firstAudioMs + leadingSilenceMs (which is 200)
    expect(result.perceivedMs).toBe(400);
  });

  it("gives 250 for a single chunk with 50 ms of silence arriving at 200 ms", () => {
    const sampleRate = 24_000;
    const silenceCount = 1200; // 50 ms
    const sineCount = 1200; // 50 ms
    const pcm = new Int16Array(silenceCount + sineCount);
    for (let i = 0; i < sineCount; i++) {
      pcm[silenceCount + i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    }

    const chunk: Chunk = {
      atMs: 200,
      pcm,
    };

    const result = analyze([chunk], sampleRate, 300);
    expect(result.firstAudioMs).toBe(200);
    expect(result.leadingSilenceMs).toBeCloseTo(50, 0);
    expect(result.perceivedMs).toBeCloseTo(250, 0);
  });

  it("throws when there is no audio", () => {
    expect(() => analyze([], 24_000, 100)).toThrow("No audio received.");
    expect(() => analyze([{ atMs: 50, pcm: new Int16Array(0) }], 24_000, 100)).toThrow(
      "No audio received.",
    );
  });
});

describe("pcmToWav", () => {
  it("encodes valid RIFF/WAVE header fields and payload length", () => {
    const sampleRate = 24_000;
    const samples = new Int16Array([100, 200, -300]);
    const wav = pcmToWav(samples, sampleRate);

    // Total length: 44 bytes header + 3 * 2 bytes samples = 50
    expect(wav.length).toBe(44 + 6);

    // RIFF descriptor
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(36 + 6);
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");

    // fmt subchunk
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.readUInt32LE(16)).toBe(16); // Subchunk1Size
    expect(wav.readUInt16LE(20)).toBe(1); // AudioFormat (PCM = 1)
    expect(wav.readUInt16LE(22)).toBe(1); // NumChannels (Mono = 1)
    expect(wav.readUInt32LE(24)).toBe(sampleRate);
    expect(wav.readUInt32LE(28)).toBe(sampleRate * 2); // ByteRate
    expect(wav.readUInt16LE(32)).toBe(2); // BlockAlign
    expect(wav.readUInt16LE(34)).toBe(16); // BitsPerSample

    // data subchunk
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(6);

    // PCM samples
    expect(wav.readInt16LE(44)).toBe(100);
    expect(wav.readInt16LE(46)).toBe(200);
    expect(wav.readInt16LE(48)).toBe(-300);
  });
});

describe("summarize", () => {
  it("summarizes candidate analyses into a Row", () => {
    const candidate: Candidate = {
      label: "test-voice",
      route: "direct",
      usdPerMillionChars: 39.2,
      synth: async function* () {},
    };
    const analyses: Analysis[] = Array.from({ length: 10 }, (_, i) => ({
      firstAudioMs: (i + 1) * 10,
      leadingSilenceMs: (i + 1) * 5,
      perceivedMs: (i + 1) * 20,
      audioMs: 1000,
      totalMs: 1500,
    }));

    const row = summarize(candidate, analyses);
    expect(row).toEqual({
      label: "test-voice",
      route: "direct",
      runs: 10,
      firstP50: 50,
      firstP90: 90,
      silenceP50: 25,
      perceivedP50: 100,
      perceivedP90: 180,
      usdPerMillionChars: 39.2,
    });
  });

  it("throws when analyses is empty", () => {
    const candidate: Candidate = {
      label: "test-voice",
      route: "direct",
      usdPerMillionChars: 39.2,
      synth: async function* () {},
    };
    expect(() => summarize(candidate, [])).toThrow("Cannot summarize empty analyses.");
  });
});

describe("formatTable", () => {
  it("formats rows sorted by Heard p50 with headers present", () => {
    const slowRow: Row = {
      label: "slow voice",
      route: "direct",
      runs: 8,
      firstP50: 200,
      firstP90: 250,
      silenceP50: 50,
      perceivedP50: 250,
      perceivedP90: 300,
      usdPerMillionChars: 39.2,
    };
    const fastRow: Row = {
      label: "fast voice",
      route: "inference",
      runs: 8,
      firstP50: 100,
      firstP90: 150,
      silenceP50: 20,
      perceivedP50: 120,
      perceivedP90: 160,
      usdPerMillionChars: 30,
    };

    const table = formatTable([slowRow, fastRow]);

    // Headers check
    expect(table).toContain("Voice");
    expect(table).toContain("Route");
    expect(table).toContain("Runs");
    expect(table).toContain("First audio p50");
    expect(table).toContain("First audio p90");
    expect(table).toContain("Silence p50");
    expect(table).toContain("Heard p50");
    expect(table).toContain("Heard p90");
    expect(table).toContain("$/1M chars");

    // Data check
    expect(table).toContain("fast voice");
    expect(table).toContain("slow voice");
    expect(table).toContain("120ms");
    expect(table).toContain("250ms");
    expect(table).toContain("30");
    expect(table).toContain("39.2");

    // Order check: fast voice (perceivedP50 = 120) should appear before slow voice (250)
    const fastIndex = table.indexOf("fast voice");
    const slowIndex = table.indexOf("slow voice");
    expect(fastIndex).toBeGreaterThan(-1);
    expect(slowIndex).toBeGreaterThan(fastIndex);
  });
});

describe("measure", () => {
  it("measures with fake Synth calling onStart and ensures firstAudioMs <= totalMs", async () => {
    const fakeSynth: Synth = async function* (_text, signal, onStart) {
      await new Promise((r) => setTimeout(r, 10));
      onStart();
      await new Promise((r) => setTimeout(r, 20));
      if (signal.aborted) return;
      // Yield 240 samples of 16-bit audio
      const samples1 = new Int16Array(240).fill(5000);
      yield new Uint8Array(samples1.buffer);

      await new Promise((r) => setTimeout(r, 20));
      if (signal.aborted) return;
      const samples2 = new Int16Array(240).fill(5000);
      yield new Uint8Array(samples2.buffer);
    };

    const { analysis, pcm } = await measure(fakeSynth, "test sentence", 1000);
    expect(analysis.firstAudioMs).toBeGreaterThanOrEqual(15);
    expect(analysis.firstAudioMs).toBeLessThanOrEqual(analysis.totalMs);
    expect(pcm.length).toBe(480);
  });

  it("rejects with timeout when synth hangs until aborted", async () => {
    const hangingSynth: Synth = async function* (_text, signal) {
      if (!signal.aborted) {
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      }
    };

    await expect(measure(hangingSynth, "text", 50)).rejects.toThrow("Timed out after 50 ms.");
  });
});

describe("slug", () => {
  it("converts voice labels into safe filesystem slugs", () => {
    expect(slug("cartesia sonic-3 katie (f)")).toBe("cartesia-sonic-3-katie-f");
    expect(slug("aura-2 athena (f)")).toBe("aura-2-athena-f");
    expect(slug("cartesia sonic-3 katie (f) via livekit")).toBe(
      "cartesia-sonic-3-katie-f-via-livekit",
    );
  });
});

describe("parseArgs", () => {
  it("defaults runs to 8 and parses --runs", () => {
    expect(parseArgs([])).toEqual({ runs: 8, only: undefined });
    expect(parseArgs(["--runs", "5"])).toEqual({ runs: 5, only: undefined });
    expect(parseArgs(["--runs=3"])).toEqual({ runs: 3, only: undefined });
  });

  it("clamps runs to at most SENTENCES.length * 3", () => {
    expect(parseArgs(["--runs", "100"]).runs).toBe(24);
  });

  it("parses --only substring", () => {
    expect(parseArgs(["--only", "cartesia"])).toEqual({ runs: 8, only: "cartesia" });
    expect(parseArgs(["--only=athena"])).toEqual({ runs: 8, only: "athena" });
  });
});

describe("fixtures", () => {
  it("defines exactly 8 tutor replies with Bangladeshi context", () => {
    expect(SENTENCES).toHaveLength(8);
    expect(SENTENCES[0]).toContain("Cox's Bazar");
    expect(SENTENCES[1]).toContain("Mirpur to Motijheel");
    expect(SENTENCES[2]).toContain("twelve thousand taka");
    expect(SENTENCES[3]).toContain("Chattogram");
    expect(SENTENCES[4]).toContain("Nusrat's mother cook biryani");
    expect(SENTENCES[5]).toContain("CNG");
    expect(SENTENCES[6]).toContain("Sylhet");
    expect(SENTENCES[7]).toContain("practise some more");
  });
});
