import { isUuid } from "@/lib/learner-id";
import type { Messages } from "@/lib/messages";

export const TRANSCRIPTION_TOPIC = "lk.transcription";
export const AGENT_STATE_ATTRIBUTE = "lk.agent.state";
// Set by the worker on its own participant once it creates the session (worker/main.ts).
export const SESSION_ID_ATTRIBUTE = "fluency.session_id";

export type LiveVoiceStatus = "off" | "connecting" | "listening" | "thinking" | "speaking";

export function liveStatus(agentState: string | undefined): LiveVoiceStatus | null {
  if (agentState === "listening" || agentState === "idle") {
    return "listening";
  }
  if (agentState === "thinking") {
    return "thinking";
  }
  if (agentState === "speaking") {
    return "speaking";
  }
  if (agentState === "initializing") {
    return "connecting";
  }
  return null;
}

export type TranscriptUpdate =
  | { kind: "interim"; text: string }
  | { kind: "turn"; turn: { id: string; role: "user" | "assistant"; content: string } };

export function transcriptUpdate(input: {
  senderIdentity: string;
  localIdentity: string;
  attributes: Record<string, string>;
  streamId: string;
  text: string;
}): TranscriptUpdate | null {
  const trimmed = input.text.trim();
  if (!trimmed) {
    return null;
  }

  const segmentId = input.attributes["lk.segment_id"];
  const id = segmentId && segmentId.length > 0 ? segmentId : input.streamId;
  const role = input.senderIdentity === input.localIdentity ? "user" : "assistant";

  if (role === "user" && input.attributes["lk.transcription_final"] !== "true") {
    return { kind: "interim", text: trimmed };
  }

  return {
    kind: "turn",
    turn: {
      id,
      role,
      content: trimmed,
    },
  };
}

export function sessionIdFromAttributes(changed: Record<string, string>): string | null {
  const value = changed[SESSION_ID_ATTRIBUTE];
  return isUuid(value) ? value : null;
}

// Set by the worker when it ends a session itself: "quota" or "consent".
export const END_REASON_ATTRIBUTE = "fluency.end_reason";
// Today's live voice seconds left, as a whole number, updated on every meter tick.
export const REMAINING_SECONDS_ATTRIBUTE = "fluency.remaining_seconds";

export function remainingFromAttributes(changed: Record<string, string>): number | null {
  const value = changed[REMAINING_SECONDS_ATTRIBUTE];
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

export function liveEndMessage(reason: string | null, messages: Messages["liveVoice"]): string {
  if (reason === "quota") {
    return messages.quotaUsed;
  }
  if (reason === "consent") {
    return messages.consentWithdrawn;
  }
  return messages.dropped;
}

// Set by the worker on its own participant after each saved exchange (worker/main.ts).
export const REPLY_TURN_ID_ATTRIBUTE = "fluency.reply_turn_id";

// The browser samples the mic and the agent's audio this often (hooks/useLiveVoice.ts).
export const LATENCY_TICK_MS = 10;
// Mic RMS above this is the learner speaking. With the browser's noise suppression, a quiet room
// sits far below it.
export const MIC_SPEECH_DBFS = -45;
// Agent audio RMS above this is the reply being heard. TTS silence is near digital zero.
export const AGENT_AUDIO_DBFS = -50;
// Ticks further apart than this mean the tab was throttled (hidden), so that turn isn't timed.
export const MAX_TICK_GAP_MS = 100;
// Below this, the mic was still picking up sound when the reply started (noise or overlap),
// so the number isn't a real latency.
export const MIN_LIVE_LATENCY_MS = 100;
export const MAX_LIVE_LATENCY_MS = 30_000;

// RMS level of one analyser frame in dBFS, floored at -100 (silence).
export function rmsDbfs(samples: Float32Array): number {
  if (samples.length === 0) {
    return -100;
  }
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sum += s * s;
  }
  const mean = sum / samples.length;
  if (mean <= 0) {
    return -100;
  }
  const dbfs = 20 * Math.log10(Math.sqrt(mean));
  if (!Number.isFinite(dbfs) || dbfs <= -100) {
    return -100;
  }
  return dbfs;
}

export type LatencyTracker = {
  // Feed one tick. Returns a latency in ms on the tick a reply becomes audible, otherwise null.
  tick(nowMs: number, micDbfs: number, agentDbfs: number): number | null;
  // Feed every lk.agent.state change.
  agentState(state: string): void;
};

export function createLatencyTracker(): LatencyTracker {
  let lastTickMs: number | null = null;
  let lastMicSpeechMs: number | null = null;
  let armed = false;
  let agentAudible = false;
  let lastState: string | null = null;

  return {
    agentState(state: string): void {
      // A reply starts when the state leaves listening. That is usually "thinking", but a reply
      // prepared during the learner's turn can go straight to "speaking", or both states can
      // arrive in one attribute update.
      const startsReply =
        state === "thinking" ||
        (state === "speaking" && lastState !== "thinking" && lastState !== "speaking");
      lastState = state;
      if (startsReply) {
        armed = !agentAudible;
      } else if (state === "listening") {
        armed = false;
      }
    },

    tick(nowMs: number, micDbfs: number, agentDbfs: number): number | null {
      if (lastTickMs !== null && nowMs - lastTickMs > MAX_TICK_GAP_MS) {
        lastMicSpeechMs = null;
        armed = false;
      }
      lastTickMs = nowMs;

      if (micDbfs > MIC_SPEECH_DBFS) {
        lastMicSpeechMs = nowMs;
      }

      const audible = agentDbfs > AGENT_AUDIO_DBFS;
      let result: number | null = null;

      if (audible && !agentAudible && armed) {
        armed = false;
        if (lastMicSpeechMs !== null) {
          const ms = Math.round(nowMs - lastMicSpeechMs);
          if (ms >= MIN_LIVE_LATENCY_MS && ms <= MAX_LIVE_LATENCY_MS) {
            result = ms;
          }
        }
      }

      agentAudible = audible;
      return result;
    },
  };
}
