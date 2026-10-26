import { describe, expect, it } from "vitest";

import {
  liveEndMessage,
  liveStatus,
  remainingFromAttributes,
  REMAINING_SECONDS_ATTRIBUTE,
  sessionIdFromAttributes,
  SESSION_ID_ATTRIBUTE,
  transcriptUpdate,
} from "@/lib/live-voice";
import { en } from "@/lib/messages";

describe("liveStatus", () => {
  it("maps listening and idle to listening", () => {
    expect(liveStatus("listening")).toBe("listening");
    expect(liveStatus("idle")).toBe("listening");
  });

  it("maps thinking to thinking", () => {
    expect(liveStatus("thinking")).toBe("thinking");
  });

  it("maps speaking to speaking", () => {
    expect(liveStatus("speaking")).toBe("speaking");
  });

  it("maps initializing to connecting", () => {
    expect(liveStatus("initializing")).toBe("connecting");
  });

  it("maps unknown states and undefined to null", () => {
    expect(liveStatus("unknown")).toBeNull();
    expect(liveStatus("buffering")).toBeNull();
    expect(liveStatus(undefined)).toBeNull();
  });
});

describe("transcriptUpdate", () => {
  const localIdentity = "learner";
  const agentIdentity = "agent-1";

  it("learner interim returns interim with trimmed text", () => {
    const update = transcriptUpdate({
      senderIdentity: localIdentity,
      localIdentity,
      attributes: {
        "lk.segment_id": "seg-1",
        "lk.transcription_final": "false",
      },
      streamId: "stream-1",
      text: "  hello there  ",
    });

    expect(update).toEqual({
      kind: "interim",
      text: "hello there",
    });
  });

  it("learner final returns a user turn with the segment id", () => {
    const update = transcriptUpdate({
      senderIdentity: localIdentity,
      localIdentity,
      attributes: {
        "lk.segment_id": "seg-1",
        "lk.transcription_final": "true",
      },
      streamId: "stream-1",
      text: "hello there",
    });

    expect(update).toEqual({
      kind: "turn",
      turn: {
        id: "seg-1",
        role: "user",
        content: "hello there",
      },
    });
  });

  it("agent text without final attribute returns an assistant turn", () => {
    const update = transcriptUpdate({
      senderIdentity: agentIdentity,
      localIdentity,
      attributes: {
        "lk.segment_id": "seg-2",
      },
      streamId: "stream-2",
      text: "How can I help you?",
    });

    expect(update).toEqual({
      kind: "turn",
      turn: {
        id: "seg-2",
        role: "assistant",
        content: "How can I help you?",
      },
    });
  });

  it("uses streamId when lk.segment_id is missing or empty", () => {
    const update = transcriptUpdate({
      senderIdentity: agentIdentity,
      localIdentity,
      attributes: {},
      streamId: "stream-fallback",
      text: "Greetings!",
    });

    expect(update).toEqual({
      kind: "turn",
      turn: {
        id: "stream-fallback",
        role: "assistant",
        content: "Greetings!",
      },
    });
  });

  it("returns null for whitespace-only text", () => {
    const update = transcriptUpdate({
      senderIdentity: localIdentity,
      localIdentity,
      attributes: { "lk.segment_id": "seg-1" },
      streamId: "stream-1",
      text: "    \n\t  ",
    });

    expect(update).toBeNull();
  });

  it("trims text on assistant turns", () => {
    const update = transcriptUpdate({
      senderIdentity: agentIdentity,
      localIdentity,
      attributes: { "lk.segment_id": "seg-3" },
      streamId: "stream-3",
      text: "   trimmed assistant turn   ",
    });

    expect(update).toEqual({
      kind: "turn",
      turn: {
        id: "seg-3",
        role: "assistant",
        content: "trimmed assistant turn",
      },
    });
  });
});

describe("sessionIdFromAttributes", () => {
  it("extracts a valid uuid", () => {
    const validUuid = "123e4567-e89b-12d3-a456-426614174000";
    expect(sessionIdFromAttributes({ [SESSION_ID_ATTRIBUTE]: validUuid })).toBe(validUuid);
  });

  it("returns null for a non-uuid", () => {
    expect(sessionIdFromAttributes({ [SESSION_ID_ATTRIBUTE]: "not-a-uuid" })).toBeNull();
  });

  it("returns null for a missing key", () => {
    expect(sessionIdFromAttributes({})).toBeNull();
  });
});

describe("remainingFromAttributes", () => {
  it("parses digit-only strings and returns null for invalid or missing", () => {
    expect(remainingFromAttributes({ [REMAINING_SECONDS_ATTRIBUTE]: "42" })).toBe(42);
    expect(remainingFromAttributes({ [REMAINING_SECONDS_ATTRIBUTE]: "0" })).toBe(0);
    expect(remainingFromAttributes({ [REMAINING_SECONDS_ATTRIBUTE]: "abc" })).toBeNull();
    expect(remainingFromAttributes({ [REMAINING_SECONDS_ATTRIBUTE]: "-1" })).toBeNull();
    expect(remainingFromAttributes({ [REMAINING_SECONDS_ATTRIBUTE]: "4.5" })).toBeNull();
    expect(remainingFromAttributes({})).toBeNull();
  });
});

describe("liveEndMessage", () => {
  it("maps end reasons to corresponding messages", () => {
    expect(liveEndMessage("quota", en.liveVoice)).toBe(en.liveVoice.quotaUsed);
    expect(liveEndMessage("consent", en.liveVoice)).toBe(en.liveVoice.consentWithdrawn);
    expect(liveEndMessage(null, en.liveVoice)).toBe(en.liveVoice.dropped);
    expect(liveEndMessage("unknown-reason", en.liveVoice)).toBe(en.liveVoice.dropped);
  });
});
