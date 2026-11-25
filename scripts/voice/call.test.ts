import { describe, expect, it } from "vitest";

import { parseCallArgs, parseWav } from "./call";

describe("parseCallArgs", () => {
  const validLearner = "d3b07384-d113-4674-8b63-8a39e6a00a0d";
  const validSession = "86d34e62-c840-410a-8d7b-d29ff78bc7b0";

  it("parses valid arguments with scenario and session", () => {
    const res = parseCallArgs([
      "--learner",
      validLearner,
      "--scenario",
      "job-interview",
      "--session",
      validSession,
      "turn1.wav",
      "turn2.wav",
    ]);

    expect(res).toEqual({
      learnerId: validLearner,
      scenarioId: "job-interview",
      sessionId: validSession,
      files: ["turn1.wav", "turn2.wav"],
    });
  });

  it("defaults scenario to cafe and sessionId to null", () => {
    const res = parseCallArgs(["--learner", validLearner, "turn1.wav"]);

    expect(res).toEqual({
      learnerId: validLearner,
      scenarioId: "cafe",
      sessionId: null,
      files: ["turn1.wav"],
    });
  });

  it("returns error when --learner is missing", () => {
    const res = parseCallArgs(["turn1.wav"]);
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.error).toMatch(/learner/i);
    }
  });

  it("returns error when --scenario is invalid", () => {
    const res = parseCallArgs([
      "--learner",
      validLearner,
      "--scenario",
      "outer-space",
      "turn1.wav",
    ]);
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.error).toMatch(/scenario/i);
    }
  });

  it("returns error when no files are provided", () => {
    const res = parseCallArgs(["--learner", validLearner]);
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.error).toMatch(/file/i);
    }
  });
});

describe("parseWav", () => {
  function makeWavBuffer(options: {
    sampleRate?: number;
    channels?: number;
    format?: number;
    extraChunk?: { id: string; data: Buffer };
    dataSamples?: number[];
  }): Buffer {
    const sampleRate = options.sampleRate ?? 24000;
    const channels = options.channels ?? 1;
    const format = options.format ?? 1;
    const samples = options.dataSamples ?? [0, 100, -100, 32767];

    const dataSize = samples.length * 2;
    const pcmBuffer = Buffer.alloc(dataSize);
    for (let i = 0; i < samples.length; i++) {
      pcmBuffer.writeInt16LE(samples[i], i * 2);
    }

    const extraSize = options.extraChunk
      ? 8 + options.extraChunk.data.length + (options.extraChunk.data.length % 2)
      : 0;

    const totalSize = 44 + extraSize + dataSize;
    const buf = Buffer.alloc(totalSize);

    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(totalSize - 8, 4);
    buf.write("WAVE", 8, "ascii");

    buf.write("fmt ", 12, "ascii");
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(format, 20);
    buf.writeUInt16LE(channels, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * channels * 2, 28);
    buf.writeUInt16LE(channels * 2, 32);
    buf.writeUInt16LE(16, 34);

    let offset = 36;
    if (options.extraChunk) {
      buf.write(options.extraChunk.id.padEnd(4).slice(0, 4), offset, "ascii");
      buf.writeUInt32LE(options.extraChunk.data.length, offset + 4);
      options.extraChunk.data.copy(buf, offset + 8);
      offset += 8 + options.extraChunk.data.length;
      if (options.extraChunk.data.length % 2 !== 0) {
        buf.writeUInt8(0, offset);
        offset += 1;
      }
    }

    buf.write("data", offset, "ascii");
    buf.writeUInt32LE(dataSize, offset + 4);
    pcmBuffer.copy(buf, offset + 8);

    return buf;
  }

  it("parses a valid WAV with a 44-byte header", () => {
    const wav = makeWavBuffer({ sampleRate: 16000, dataSamples: [1000, -2000] });
    expect(wav.length).toBe(48); // 44 bytes header + 4 bytes PCM (2 samples)

    const parsed = parseWav(wav);
    expect(parsed.sampleRate).toBe(16000);
    expect(parsed.samples.length).toBe(2);
    expect(parsed.samples[0]).toBe(1000);
    expect(parsed.samples[1]).toBe(-2000);
  });

  it("parses a file with an extra chunk before data", () => {
    const wav = makeWavBuffer({
      sampleRate: 24000,
      extraChunk: { id: "LIST", data: Buffer.from("metadata-info") },
      dataSamples: [10, 20, 30],
    });

    const parsed = parseWav(wav);
    expect(parsed.sampleRate).toBe(24000);
    expect(parsed.samples.length).toBe(3);
    expect(parsed.samples[0]).toBe(10);
    expect(parsed.samples[1]).toBe(20);
    expect(parsed.samples[2]).toBe(30);
  });

  it("throws when channels is stereo (2 channels)", () => {
    const stereoWav = makeWavBuffer({ channels: 2 });
    expect(() => parseWav(stereoWav)).toThrow(/afconvert/);
  });
});
