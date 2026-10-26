// Azure pronunciation assessment takes 16 kHz mono 16-bit PCM.
export const SCORING_SAMPLE_RATE = 16_000;

// Flux reports the start of speech a little after it begins, so the cut starts earlier.
export const TURN_AUDIO_LEAD_MS = 1000;
export const TURN_AUDIO_TAIL_MS = 300;

// The buffer never holds more than this; older audio is dropped.
export const MAX_TURN_AUDIO_MS = 60_000;

// Turns this short give Azure too little to score reliably ("Yes.", "Okay").
export const MIN_SCORED_WORDS = 3;
export const MIN_SCORED_AUDIO_MS = 1000;

// At shutdown the worker waits this long for scoring still in flight, then gives up on it.
export const SCORING_DRAIN_MS = 15_000;

// 16 samples per ms at 16 kHz.
export function pcmDurationMs(samples: number): number {
  return Math.round(samples / 16);
}

export function shouldScore(text: string, audioMs: number): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length >= MIN_SCORED_WORDS && audioMs >= MIN_SCORED_AUDIO_MS;
}

export function concatPcm(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

type TurnAudioChunk = { pcm: Int16Array; endMs: number };

// The learner's recent 16 kHz audio, kept in memory only until each turn is cut out of it.
// A chunk covers [endMs - its duration, endMs], where endMs is when it was received.
export class TurnAudioBuffer {
  private chunks: TurnAudioChunk[] = [];
  private bufferedSamples = 0;

  push(pcm: Int16Array, receivedAtMs: number): void {
    this.chunks.push({ pcm, endMs: receivedAtMs });
    this.bufferedSamples += pcm.length;
    while (pcmDurationMs(this.bufferedSamples) > MAX_TURN_AUDIO_MS && this.chunks.length > 0) {
      const oldest = this.chunks.shift()!;
      this.bufferedSamples -= oldest.pcm.length;
    }
  }

  // One learner turn, by its speaking times (undefined: from the oldest / up to the newest chunk).
  // Returns whole chunks that overlap the window and drops everything up to the window's end.
  take(startedAtMs: number | undefined, stoppedAtMs: number | undefined): Int16Array {
    const from = startedAtMs === undefined ? -Infinity : startedAtMs - TURN_AUDIO_LEAD_MS;
    const to = stoppedAtMs === undefined ? Infinity : stoppedAtMs + TURN_AUDIO_TAIL_MS;

    const taken: Int16Array[] = [];
    const kept: TurnAudioChunk[] = [];
    for (const chunk of this.chunks) {
      const startMs = chunk.endMs - pcmDurationMs(chunk.pcm.length);
      if (chunk.endMs > from && startMs < to) taken.push(chunk.pcm);
      if (chunk.endMs > to) kept.push(chunk);
    }

    this.chunks = kept;
    this.bufferedSamples = kept.reduce((sum, chunk) => sum + chunk.pcm.length, 0);
    return concatPcm(taken);
  }
}
