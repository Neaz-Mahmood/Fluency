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
