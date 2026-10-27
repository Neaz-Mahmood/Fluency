import { describe, expect, it } from "vitest";

import { formatTimeline, frameDbfs, TurnTimeline } from "./timeline";

const STOP = 1_000_000;

describe("formatTimeline", () => {
  it("marks a reply drafted before the end of turn as preemptive, with its lead", () => {
    const line = formatTimeline({
      stoppedSpeakingAt: STOP,
      endOfTurnAt: STOP + 384,
      agentSpeakingAt: STOP + 1082,
      transcriptionDelayMs: 40.4,
      lastWordEndAt: STOP - 280,
      llmCalls: [
        { startedAt: STOP + 50, firstOutputAt: STOP + 400 }, // cancelled draft
        { startedAt: STOP + 120, firstOutputAt: STOP + 480 },
      ],
      ttsCalls: [
        {
          startedAt: STOP + 390,
          firstInputAt: STOP + 485,
          firstOutputAt: STOP + 628,
          firstAudibleAt: STOP + 700,
        },
      ],
    });
    expect(line).toBe(
      "[voice] timeline: last word -280, eot +384, transcript delay 40 | llm +120 (preemptive, lead 264) first token +480 | tts +390 first text +485 first audio +628 audible +700 | speaking +1082 | llm calls 2, tts calls 1 | t0 1000000",
    );
  });

  it("marks a reply started after the end of turn", () => {
    const line = formatTimeline({
      stoppedSpeakingAt: STOP,
      endOfTurnAt: STOP + 300,
      agentSpeakingAt: STOP + 900,
      transcriptionDelayMs: undefined,
      lastWordEndAt: undefined,
      llmCalls: [{ startedAt: STOP + 310 }],
      ttsCalls: [],
    });
    expect(line).toContain("last word n/a, eot +300, transcript delay n/a");
    expect(line).toContain("llm +310 (after eot) first token n/a");
    expect(line).toContain("tts n/a");
  });

  it("ignores calls started after the agent began speaking", () => {
    const line = formatTimeline({
      stoppedSpeakingAt: STOP,
      endOfTurnAt: STOP + 300,
      agentSpeakingAt: STOP + 900,
      transcriptionDelayMs: undefined,
      lastWordEndAt: undefined,
      llmCalls: [{ startedAt: STOP + 100 }, { startedAt: STOP + 2000 }],
      ttsCalls: [],
    });
    expect(line).toContain("llm +100 (preemptive, lead 200)");
  });

  it("shows a draft started while the learner was still speaking as a negative offset", () => {
    const line = formatTimeline({
      stoppedSpeakingAt: STOP,
      endOfTurnAt: STOP + 300,
      agentSpeakingAt: STOP + 900,
      transcriptionDelayMs: undefined,
      lastWordEndAt: undefined,
      llmCalls: [{ startedAt: STOP - 40 }],
      ttsCalls: [],
    });
    expect(line).toContain("llm -40 (preemptive, lead 340)");
  });
});

describe("TurnTimeline", () => {
  it("hands over the calls once and starts the next turn empty", () => {
    const timeline = new TurnTimeline();
    timeline.llmStarted(1);
    timeline.ttsStarted(2);
    timeline.lastWordEnded(3);
    expect(timeline.take()).toEqual({
      llmCalls: [{ startedAt: 1 }],
      ttsCalls: [{ startedAt: 2 }],
      lastWordEndAt: 3,
    });
    expect(timeline.take()).toEqual({ llmCalls: [], ttsCalls: [], lastWordEndAt: undefined });
  });
});

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
