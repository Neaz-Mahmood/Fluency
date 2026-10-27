import { isUuid } from "@/lib/learner-id";
import type { CefrLevel } from "@/lib/placement";
import { isScenarioId, type ScenarioId } from "@/lib/scenarios";

// Dispatched by task 10's token route.
export const AGENT_NAME = "fluency-tutor";

// Deepgram Flux through LiveKit Inference; see doc/voice-path.md (Decision 1).
export const STT_MODEL = "deepgram/flux-general-en";

// Flux eager_eot_threshold for preemptive generation; see doc/voice-path.md (The latency budget).
// 0.4 was tried in FLU-73: drafts still started about 280 ms before the end of turn, so it only
// added draft calls.
export const EAGER_EOT_THRESHOLD = 0.5;

// Gemma 4 31B through LiveKit Inference; see doc/voice-path.md (Decision 2).
export const LLM_MODEL = "google/gemma-4-31b-it";

// Cartesia Sonic-3 through LiveKit Inference; see doc/voice-path.md (Decision 3).
export const TTS_MODEL = "cartesia/sonic-3";

// Cartesia Sonic-3 Katie voice ID; see doc/voice-path.md (Decision 3).
export const TTS_VOICE_KATIE = "f786b574-daa5-4673-aa0c-cbe3e8534c02";

// Keeps 'en' even for Bangla words; see doc/voice-path.md (Decision 3).
export const TTS_LANGUAGE = "en";

// Cartesia speed by listening level: slower for beginners. 1.0 is Cartesia's normal pace.
export const TTS_SPEED_BY_LEVEL: Record<CefrLevel, number> = {
  A1: 0.8,
  A2: 0.9,
  B1: 1.0,
  B2: 1.0,
  C1: 1.0,
  C2: 1.0,
};

// Before placement there is no level; most learners start as beginners.
export const TTS_SPEED_NO_LEVEL = 0.9;

export function ttsSpeedForLevel(level: CefrLevel | null): number {
  return level ? TTS_SPEED_BY_LEVEL[level] : TTS_SPEED_NO_LEVEL;
}

export type VoiceJob = {
  learnerId: string;
  scenarioId: ScenarioId;
  sessionId: string | null;
};

export function parseJobMetadata(raw: string | undefined): VoiceJob | { error: string } {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return { error: "Job metadata is missing or empty." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "Job metadata is not valid JSON." };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: "Job metadata must be an object." };
  }

  const obj = parsed as Record<string, unknown>;

  if (!isUuid(obj.learnerId)) {
    return { error: "Job metadata has no valid learnerId." };
  }

  if (typeof obj.scenarioId !== "string" || !isScenarioId(obj.scenarioId)) {
    return { error: "Job metadata has no valid scenarioId." };
  }

  let sessionId: string | null = null;
  if (obj.sessionId !== undefined && obj.sessionId !== null) {
    if (!isUuid(obj.sessionId)) {
      return { error: "Job metadata has no valid sessionId." };
    }
    sessionId = obj.sessionId;
  }

  return {
    learnerId: obj.learnerId,
    scenarioId: obj.scenarioId,
    sessionId,
  };
}

export type VoiceMessage = {
  role: string;
  text: string;
  llmTtftSeconds?: number;
};

export type VoiceExchange = {
  userText: string;
  replyText: string;
  firstTokenMs: number | null;
};

export class ExchangeCollector {
  private userBuffer: string | null = null;

  add(message: VoiceMessage): VoiceExchange | null {
    if (message.role === "user") {
      const trimmed = message.text.trim();
      if (!trimmed) {
        return null;
      }
      if (this.userBuffer !== null) {
        this.userBuffer += " " + trimmed;
      } else {
        this.userBuffer = trimmed;
      }
      return null;
    }

    if (message.role === "assistant") {
      if (this.userBuffer === null) {
        return null;
      }
      const userText = this.userBuffer;
      this.userBuffer = null;

      const firstTokenMs =
        typeof message.llmTtftSeconds === "number" && Number.isFinite(message.llmTtftSeconds)
          ? Math.round(message.llmTtftSeconds * 1000)
          : null;

      return {
        userText,
        replyText: message.text.trim(),
        firstTokenMs,
      };
    }

    return null;
  }

  flush(): VoiceExchange | null {
    if (this.userBuffer !== null) {
      const userText = this.userBuffer;
      this.userBuffer = null;
      return {
        userText,
        replyText: "",
        firstTokenMs: null,
      };
    }
    return null;
  }
}

// How often a running session's time is written to voice_usage.
export const METER_INTERVAL_MS = 15_000;

// Spoken when the day's live voice time runs out, before the room closes.
export const QUOTA_GOODBYE =
  "That's our live voice time for today. Great practice! You can keep going by typing.";

export class VoiceMeter {
  // A plain field, not a parameter property: Node's type stripping can't run those.
  private readonly startMs: number;
  private returned = 0;

  constructor(startMs: number) {
    this.startMs = startMs;
  }

  // Whole seconds elapsed since startMs that haven't been returned yet. Fractions carry over.
  take(nowMs: number): number {
    const elapsedSeconds = Math.floor((nowMs - this.startMs) / 1000);
    const toReturn = Math.max(0, elapsedSeconds - this.returned);
    this.returned += toReturn;
    return toReturn;
  }
}

// Delay until the next meter tick: every METER_INTERVAL_MS, but sooner when less time is left,
// so the cut-off lands on time. Never under 1 s.
export function nextMeterDelayMs(remainingSeconds: number): number {
  return Math.max(1000, Math.min(METER_INTERVAL_MS, remainingSeconds * 1000));
}
