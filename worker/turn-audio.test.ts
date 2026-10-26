import { describe, expect, it } from "vitest";

import { concatPcm, MAX_TURN_AUDIO_MS, shouldScore, TurnAudioBuffer } from "./turn-audio";

// 100 ms at 16 kHz.
const CHUNK_SAMPLES = 1600;

// Chunk i covers [i * 100, (i + 1) * 100] ms and every sample in it is i, so tests can see which
// chunks came back.
function bufferWithChunks(count: number): TurnAudioBuffer {
  const buffer = new TurnAudioBuffer();
  for (let i = 0; i < count; i++) {
    buffer.push(new Int16Array(CHUNK_SAMPLES).fill(i), (i + 1) * 100);
  }
  return buffer;
}

function chunkIds(pcm: Int16Array): number[] {
  const ids: number[] = [];
  for (let offset = 0; offset < pcm.length; offset += CHUNK_SAMPLES) ids.push(pcm[offset]);
  return ids;
}

describe("shouldScore", () => {
  it("skips a turn under three words", () => {
    expect(shouldScore("Yes, okay.", 2000)).toBe(false);
  });

  it("skips a turn under one second", () => {
    expect(shouldScore("I like tea", 999)).toBe(false);
  });

  it("scores three words over one second", () => {
    expect(shouldScore("I like tea", 1000)).toBe(true);
  });
});

describe("concatPcm", () => {
  it("joins chunks in order", () => {
    expect(concatPcm([Int16Array.of(1, 2), Int16Array.of(), Int16Array.of(3)])).toEqual(
      Int16Array.of(1, 2, 3),
    );
  });

  it("returns an empty array for no chunks", () => {
    expect(concatPcm([])).toEqual(new Int16Array(0));
  });
});

describe("TurnAudioBuffer.take", () => {
  it("returns the chunks that overlap the window and drops the earlier ones", () => {
    const buffer = bufferWithChunks(10);

    // Window: 1400 - 1000 lead = 400 to 600 + 300 tail = 900.
    expect(chunkIds(buffer.take(1400, 600))).toEqual([4, 5, 6, 7, 8]);
    // Chunks 0–3, before the window, were dropped too.
    expect(chunkIds(buffer.take(undefined, undefined))).toEqual([9]);
  });

  it("returns everything when both bounds are undefined", () => {
    const buffer = bufferWithChunks(5);
    expect(chunkIds(buffer.take(undefined, undefined))).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns an empty array when nothing is in the window", () => {
    const buffer = bufferWithChunks(5);
    expect(buffer.take(5000, 6000)).toEqual(new Int16Array(0));
  });

  it("doesn't return the same audio twice", () => {
    const buffer = bufferWithChunks(5);
    expect(chunkIds(buffer.take(undefined, 200))).toEqual([0, 1, 2, 3, 4]);
    expect(buffer.take(undefined, 200)).toEqual(new Int16Array(0));
  });

  it("drops the oldest chunks past MAX_TURN_AUDIO_MS", () => {
    const cap = MAX_TURN_AUDIO_MS / 100;
    const buffer = bufferWithChunks(cap + 2);

    const ids = chunkIds(buffer.take(undefined, undefined));
    expect(ids).toHaveLength(cap);
    expect(ids[0]).toBe(2);
    expect(ids.at(-1)).toBe(cap + 1);
  });
});
