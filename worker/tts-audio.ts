import { TransformStream } from "node:stream/web";

// Cartesia's replies often open with near-silent frames: 80 ms at p50 and 150 ms at p90 before the
// first frame the browser can hear (FLU-72). Dropping them lets the learner hear the reply that
// much sooner (FLU-73).

// Frames quieter than this at the very start of a reply are dropped. The browser counts audio as
// heard from -50 dBFS (AGENT_AUDIO_DBFS), so this stays 10 dB below it and never cuts a soft
// first sound.
export const LEADING_SILENCE_DBFS = -60;
// At most this much is trimmed, so a reply that opens quietly on purpose still plays.
export const MAX_LEADING_TRIM_MS = 300;

export type PcmFrame = { data: Int16Array; samplesPerChannel: number; sampleRate: number };

// RMS level of a 16-bit PCM frame in dBFS, floored at -100, like rmsDbfs in lib/live-voice.ts.
export function frameDbfs(samples: Int16Array): number {
  if (samples.length === 0) return -100;
  let sum = 0;
  for (const sample of samples) sum += (sample / 32768) ** 2;
  const dbfs = 10 * Math.log10(sum / samples.length);
  return Number.isFinite(dbfs) && dbfs > -100 ? dbfs : -100;
}

// Drops a reply's leading near-silent frames; everything from the first louder frame on passes.
export function trimLeadingSilence<T extends PcmFrame>(): TransformStream<T, T> {
  let trimming = true;
  let trimmedMs = 0;
  return new TransformStream<T, T>({
    transform(frame, controller) {
      if (trimming) {
        const durationMs = (frame.samplesPerChannel / frame.sampleRate) * 1000;
        if (
          frameDbfs(frame.data) < LEADING_SILENCE_DBFS &&
          trimmedMs + durationMs <= MAX_LEADING_TRIM_MS
        ) {
          trimmedMs += durationMs;
          return;
        }
        trimming = false;
      }
      controller.enqueue(frame);
    },
  });
}
