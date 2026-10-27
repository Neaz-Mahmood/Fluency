import { ReadableStream } from "node:stream/web";

import { describe, expect, it } from "vitest";

import { frameDbfs, MAX_LEADING_TRIM_MS, trimLeadingSilence, type PcmFrame } from "./tts-audio";

// 10 ms at 24 kHz, every sample set to `level`.
function frame(level: number): PcmFrame {
  return { data: new Int16Array(240).fill(level), samplesPerChannel: 240, sampleRate: 24_000 };
}

async function trim(frames: PcmFrame[]): Promise<number[]> {
  const out: number[] = [];
  const stream = ReadableStream.from(frames).pipeThrough(trimLeadingSilence<PcmFrame>());
  for await (const f of stream) out.push(f.data[0]);
  return out;
}

describe("frameDbfs", () => {
  it("is 0 dBFS at full scale and floors silence at -100", () => {
    expect(frameDbfs(new Int16Array(480).fill(-32768))).toBeCloseTo(0);
    expect(frameDbfs(new Int16Array(480))).toBe(-100);
    expect(frameDbfs(new Int16Array(0))).toBe(-100);
  });

  it("puts a quiet frame below the browser's -50 dBFS threshold and speech above it", () => {
    expect(frameDbfs(new Int16Array(480).fill(50))).toBeLessThan(-50);
    expect(frameDbfs(new Int16Array(480).fill(3000))).toBeGreaterThan(-50);
  });
});

describe("trimLeadingSilence", () => {
  it("drops near-silent frames before the first louder one", async () => {
    expect(await trim([frame(0), frame(5), frame(3000), frame(4000)])).toEqual([3000, 4000]);
  });

  it("keeps quiet frames once the reply has started", async () => {
    expect(await trim([frame(0), frame(3000), frame(0), frame(3000)])).toEqual([3000, 0, 3000]);
  });

  it("keeps a soft first sound between -60 and -50 dBFS", async () => {
    // 20 is about -64 dBFS, 60 about -55 dBFS.
    expect(await trim([frame(20), frame(60), frame(3000)])).toEqual([60, 3000]);
  });

  it("trims at most the cap, then plays the rest even if it is quiet", async () => {
    const silent = Array.from({ length: MAX_LEADING_TRIM_MS / 10 + 5 }, () => frame(0));
    const out = await trim([...silent, frame(3000)]);
    expect(out).toHaveLength(5 + 1);
  });
});
