import { describe, expect, it } from "vitest";

import {
  audioStatsLine,
  createLatencyTracker,
  liveEndMessage,
  liveStatus,
  readAudioStats,
  remainingFromAttributes,
  REMAINING_SECONDS_ATTRIBUTE,
  rmsDbfs,
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

describe("rmsDbfs", () => {
  it("returns -100 for zeros", () => {
    expect(rmsDbfs(new Float32Array(512))).toBe(-100);
  });

  it("returns about -6.02 for a constant 0.5", () => {
    const samples = new Float32Array(512).fill(0.5);
    expect(rmsDbfs(samples)).toBeCloseTo(-6.02, 2);
  });

  it("returns -100 for an empty array", () => {
    expect(rmsDbfs(new Float32Array([]))).toBe(-100);
  });
});

describe("createLatencyTracker", () => {
  it("measures a normal reply from speech end to first audible agent audio", () => {
    const tracker = createLatencyTracker();
    for (let t = 0; t <= 1000; t += 10) {
      expect(tracker.tick(t, -30, -60)).toBeNull();
    }
    for (let t = 1010; t < 1200; t += 10) {
      expect(tracker.tick(t, -60, -60)).toBeNull();
    }
    tracker.agentState("thinking");
    for (let t = 1200; t < 1700; t += 10) {
      expect(tracker.tick(t, -60, -60)).toBeNull();
    }
    expect(tracker.tick(1700, -60, -40)).toBe(700);
    for (let t = 1710; t <= 2000; t += 10) {
      expect(tracker.tick(t, -60, -40)).toBeNull();
    }
  });

  it("does not count a pause inside a reply as a second reply", () => {
    const tracker = createLatencyTracker();
    for (let t = 0; t <= 1000; t += 10) tracker.tick(t, -30, -60);
    for (let t = 1010; t < 1200; t += 10) tracker.tick(t, -60, -60);
    tracker.agentState("thinking");
    for (let t = 1200; t < 1700; t += 10) tracker.tick(t, -60, -60);
    expect(tracker.tick(1700, -60, -40)).toBe(700);

    for (let t = 1710; t < 2000; t += 10) tracker.tick(t, -60, -40);
    // agent quiet from 2000
    for (let t = 2000; t < 2300; t += 10) tracker.tick(t, -60, -60);
    // agent audible again at 2300, still thinking/speaking
    tracker.agentState("speaking");
    expect(tracker.tick(2300, -60, -40)).toBeNull();
  });

  it("returns null if audio starts with no thinking or speaking state", () => {
    const tracker = createLatencyTracker();
    for (let t = 0; t <= 1000; t += 10) tracker.tick(t, -30, -60);
    for (let t = 1010; t < 1700; t += 10) tracker.tick(t, -60, -60);
    expect(tracker.tick(1700, -60, -40)).toBeNull();
  });

  it("measures a reply that goes straight from listening to speaking", () => {
    const tracker = createLatencyTracker();
    for (let t = 0; t <= 1000; t += 10) tracker.tick(t, -30, -60);
    for (let t = 1010; t < 1600; t += 10) tracker.tick(t, -60, -60);
    tracker.agentState("speaking");
    tracker.tick(1600, -60, -60);
    expect(tracker.tick(1610, -60, -40)).toBe(610);
  });

  it("returns null if speaking arrives after the reply is already audible", () => {
    const tracker = createLatencyTracker();
    for (let t = 0; t <= 1000; t += 10) tracker.tick(t, -30, -60);
    for (let t = 1010; t < 1500; t += 10) tracker.tick(t, -60, -60);
    tracker.tick(1500, -60, -40);
    tracker.agentState("speaking");
    tracker.tick(1510, -60, -60);
    expect(tracker.tick(1520, -60, -40)).toBeNull();
  });

  it("returns null if thinking arrives while agent is already audible", () => {
    const tracker = createLatencyTracker();
    for (let t = 0; t <= 1000; t += 10) tracker.tick(t, -30, -60);
    for (let t = 1010; t < 1500; t += 10) tracker.tick(t, -60, -60);
    tracker.tick(1500, -60, -40);
    tracker.agentState("thinking");
    expect(tracker.tick(1510, -60, -40)).toBeNull();
  });

  it("returns null if thinking returns to listening before audio starts (cancelled reply)", () => {
    const tracker = createLatencyTracker();
    for (let t = 0; t <= 1000; t += 10) tracker.tick(t, -30, -60);
    tracker.agentState("thinking");
    tracker.tick(1200, -60, -60);
    tracker.agentState("listening");
    for (let t = 1210; t < 1700; t += 10) tracker.tick(t, -60, -60);
    expect(tracker.tick(1700, -60, -40)).toBeNull();
  });

  it("returns null when there is a tick gap > 100 ms between speech and reply", () => {
    const tracker = createLatencyTracker();
    for (let t = 0; t <= 1000; t += 10) tracker.tick(t, -30, -60);
    // 500 ms gap to t=1500
    tracker.tick(1500, -60, -60);
    tracker.agentState("thinking");
    for (let t = 1510; t < 1700; t += 10) tracker.tick(t, -60, -60);
    expect(tracker.tick(1700, -60, -40)).toBeNull();
  });

  it("returns null if mic is still loud at onset tick (noise/overlap < 100 ms)", () => {
    const tracker = createLatencyTracker();
    for (let t = 0; t < 1200; t += 10) tracker.tick(t, -60, -60);
    tracker.agentState("thinking");
    for (let t = 1200; t < 1700; t += 10) tracker.tick(t, -60, -60);
    expect(tracker.tick(1700, -30, -40)).toBeNull();
  });

  it("measures a second normal turn after the first", () => {
    const tracker = createLatencyTracker();
    // Turn 1
    for (let t = 0; t <= 1000; t += 10) tracker.tick(t, -30, -60);
    tracker.agentState("thinking");
    for (let t = 1010; t < 1700; t += 10) tracker.tick(t, -60, -60);
    expect(tracker.tick(1700, -60, -40)).toBe(700);

    for (let t = 1710; t < 2200; t += 10) tracker.tick(t, -60, -40);
    for (let t = 2200; t < 2500; t += 10) tracker.tick(t, -60, -60);
    tracker.agentState("listening");

    // Turn 2
    for (let t = 2500; t <= 3000; t += 10) tracker.tick(t, -30, -60);
    for (let t = 3010; t < 3200; t += 10) tracker.tick(t, -60, -60);
    tracker.agentState("thinking");
    for (let t = 3200; t < 3700; t += 10) tracker.tick(t, -60, -60);
    expect(tracker.tick(3700, -60, -40)).toBe(700);
  });
});

describe("readAudioStats", () => {
  it("reads the audio jitter buffer and the selected pair's round trip", () => {
    expect(
      readAudioStats([
        { type: "inbound-rtp", kind: "video", jitterBufferDelay: 9, jitterBufferEmittedCount: 9 },
        {
          type: "inbound-rtp",
          kind: "audio",
          jitterBufferDelay: 4800,
          jitterBufferEmittedCount: 96_000,
        },
        { type: "candidate-pair", state: "failed", nominated: true, currentRoundTripTime: 1 },
        {
          type: "candidate-pair",
          state: "succeeded",
          nominated: true,
          currentRoundTripTime: 0.084,
        },
      ]),
    ).toEqual({ jitterBufferDelay: 4800, jitterBufferEmittedCount: 96_000, roundTripTime: 0.084 });
  });

  it("returns null without audio inbound stats", () => {
    expect(readAudioStats([{ type: "candidate-pair", state: "succeeded" }])).toBeNull();
  });
});

describe("audioStatsLine", () => {
  const first = { jitterBufferDelay: 4800, jitterBufferEmittedCount: 96_000, roundTripTime: 0.084 };

  it("averages the jitter buffer from the start without a previous sample", () => {
    expect(audioStatsLine(null, first, "India South")).toBe(
      "[voice] network: rtt 84 ms, jitter buffer 50 ms, edge India South",
    );
  });

  it("averages only the samples since the previous line", () => {
    const next = {
      jitterBufferDelay: 7200,
      jitterBufferEmittedCount: 144_000,
      roundTripTime: null,
    };
    expect(audioStatsLine(first, next, undefined)).toBe(
      "[voice] network: rtt n/a, jitter buffer 50 ms, edge unknown",
    );
  });

  it("shows n/a when nothing played since the previous line", () => {
    expect(audioStatsLine(first, first, "India South")).toContain("jitter buffer n/a");
  });
});
