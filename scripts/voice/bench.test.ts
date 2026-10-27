import { describe, expect, it } from "vitest";

import { DEFAULT_WAV, parseBenchArgs, parseNetworkLine, wavDurationSeconds } from "./bench.ts";

// A 16-bit mono PCM WAV header plus `dataBytes` of silence, with an extra chunk before data.
function wav(sampleRate: number, dataBytes: number): Uint8Array {
  const bytes = new Uint8Array(12 + 24 + 12 + 8 + dataBytes);
  const view = new DataView(bytes.buffer);
  const write = (at: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "LIST");
  view.setUint32(40, 4, true);
  write(44, "INFO");
  write(48, "data");
  view.setUint32(52, dataBytes, true);
  return bytes;
}

describe("parseBenchArgs", () => {
  it("defaults to three learners against the local app", () => {
    expect(parseBenchArgs([])).toEqual({
      url: "http://localhost:3000",
      learners: 3,
      wav: DEFAULT_WAV,
    });
  });

  it("reads flags with spaces or equals signs", () => {
    expect(
      parseBenchArgs(["--url=http://localhost:3100/", "--learners", "2", "--wav", "a.wav"]),
    ).toEqual({
      url: "http://localhost:3100",
      learners: 2,
      wav: "a.wav",
    });
  });

  it("rejects learner counts outside 1–5", () => {
    expect(parseBenchArgs(["--learners", "6"])).toEqual({ error: "--learners must be 1–5." });
    expect(parseBenchArgs(["--learners", "0"])).toEqual({ error: "--learners must be 1–5." });
  });

  it("rejects unknown flags and missing values", () => {
    expect(parseBenchArgs(["--since", "x"])).toEqual({ error: "Unknown argument: --since" });
    expect(parseBenchArgs(["--url"])).toEqual({ error: "Missing value for --url." });
  });
});

describe("wavDurationSeconds", () => {
  it("divides the data size by the byte rate, skipping other chunks", () => {
    expect(wavDurationSeconds(wav(24_000, 48_000 * 3))).toBe(3);
  });

  it("rejects a file that isn't a WAV", () => {
    expect(() => wavDurationSeconds(new Uint8Array(64))).toThrow("Not a WAV file.");
  });
});

describe("parseNetworkLine", () => {
  it("reads the round trip and jitter buffer", () => {
    expect(
      parseNetworkLine("[voice] network: rtt 84 ms, jitter buffer 61 ms, edge India South"),
    ).toEqual({ rttMs: 84, bufferMs: 61 });
  });

  it("leaves missing numbers null", () => {
    expect(parseNetworkLine("[voice] network: rtt n/a, jitter buffer n/a, edge unknown")).toEqual({
      rttMs: null,
      bufferMs: null,
    });
  });
});
