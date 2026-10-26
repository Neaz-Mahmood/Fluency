import { isUuid } from "@/lib/learner-id";

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
