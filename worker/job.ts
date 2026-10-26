import { isUuid } from "@/lib/learner-id";
import { isScenarioId, type ScenarioId } from "@/lib/scenarios";

// Dispatched by task 10's token route.
export const AGENT_NAME = "fluency-tutor";

// Deepgram Flux through LiveKit Inference; see doc/voice-path.md (Decision 1).
export const STT_MODEL = "deepgram/flux-general-en";

// Flux eager_eot_threshold for preemptive generation; see doc/voice-path.md (The latency budget).
export const EAGER_EOT_THRESHOLD = 0.5;

// Gemma 4 31B through LiveKit Inference; see doc/voice-path.md (Decision 2).
export const LLM_MODEL = "google/gemma-4-31b-it";

// Cartesia Sonic-3 through LiveKit Inference; see doc/voice-path.md (Decision 3).
export const TTS_MODEL = "cartesia/sonic-3";

// Cartesia Sonic-3 Katie voice ID; see doc/voice-path.md (Decision 3).
export const TTS_VOICE_KATIE = "f786b574-daa5-4673-aa0c-cbe3e8534c02";

// Keeps 'en' even for Bangla words; see doc/voice-path.md (Decision 3).
export const TTS_LANGUAGE = "en";

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
