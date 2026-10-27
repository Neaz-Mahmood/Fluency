import { llm, stt, voice } from "@livekit/agents";
import type { AudioFrame } from "@livekit/rtc-node";
import { ReadableStream, TransformStream } from "node:stream/web";

import { AGENT_AUDIO_DBFS } from "@/lib/live-voice";

// Where each reply's time goes (FLU-72). LiveKit reports each stage's own duration; this records
// when each one happened, on the worker's clock, so the gaps between stages show up too.

type Call = {
  startedAt: number;
  firstOutputAt?: number;
  firstInputAt?: number;
  // TTS only: the first frame loud enough for the browser to count it as the reply (FLU-63).
  firstAudibleAt?: number;
};

export type TurnTiming = {
  // Epoch ms, all on the worker's clock (LiveKit's speaking times are Date.now() based too).
  stoppedSpeakingAt: number;
  endOfTurnAt: number;
  agentSpeakingAt: number;
  // From the learner's last word to Flux's final transcript, as LiveKit reports it.
  transcriptionDelayMs: number | undefined;
  // The end of the learner's last word by Flux's word timings. LiveKit's stoppedSpeakingAt comes
  // from the end of Flux's transcript segment instead, which can run past the last word.
  lastWordEndAt: number | undefined;
  llmCalls: Call[];
  ttsCalls: Call[];
};

// Records when LLM and TTS calls start and produce their first output. The worker reads it
// once per reply (take), which also clears it for the next turn.
export class TurnTimeline {
  private llmCalls: Call[] = [];
  private ttsCalls: Call[] = [];
  private lastWordEndAt: number | undefined;

  lastWordEnded(at: number): void {
    this.lastWordEndAt = at;
  }

  llmStarted(at = Date.now()): Call {
    const call = { startedAt: at };
    this.llmCalls.push(call);
    return call;
  }

  ttsStarted(at = Date.now()): Call {
    const call = { startedAt: at };
    this.ttsCalls.push(call);
    return call;
  }

  take(): { llmCalls: Call[]; ttsCalls: Call[]; lastWordEndAt: number | undefined } {
    const taken = {
      llmCalls: this.llmCalls,
      ttsCalls: this.ttsCalls,
      lastWordEndAt: this.lastWordEndAt,
    };
    this.llmCalls = [];
    this.ttsCalls = [];
    this.lastWordEndAt = undefined;
    return taken;
  }
}

// The call that produced the reply: the last one started before the agent began speaking.
function replyCall(calls: Call[], agentSpeakingAt: number): Call | undefined {
  return calls.filter((call) => call.startedAt <= agentSpeakingAt).at(-1);
}

function offset(at: number | undefined, from: number): string {
  if (at === undefined || !Number.isFinite(at)) return "n/a";
  const ms = Math.round(at - from);
  return ms < 0 ? `${ms}` : `+${ms}`;
}

// One log line per reply, every time relative to the moment the learner stopped speaking:
// [voice] timeline: last word -280, eot +384, transcript delay 40 | llm +120 (preemptive, lead 264) first token
// +480 | tts +390 first text +485 first audio +628 audible +700 | speaking +628 | llm calls 2, tts calls 1
// | t0 1793081354844
export function formatTimeline(timing: TurnTiming): string {
  const t0 = timing.stoppedSpeakingAt;
  const llmCall = replyCall(timing.llmCalls, timing.agentSpeakingAt);
  const ttsCall = replyCall(timing.ttsCalls, timing.agentSpeakingAt);

  let llmPart = "llm n/a";
  if (llmCall) {
    const lead = timing.endOfTurnAt - llmCall.startedAt;
    const mode = lead > 0 ? `preemptive, lead ${Math.round(lead)}` : "after eot";
    llmPart = `llm ${offset(llmCall.startedAt, t0)} (${mode}) first token ${offset(llmCall.firstOutputAt, t0)}`;
  }

  const ttsPart = ttsCall
    ? `tts ${offset(ttsCall.startedAt, t0)} first text ${offset(ttsCall.firstInputAt, t0)} first audio ${offset(ttsCall.firstOutputAt, t0)} audible ${offset(ttsCall.firstAudibleAt, t0)}`
    : "tts n/a";

  return [
    `[voice] timeline: last word ${offset(timing.lastWordEndAt, t0)}, eot ${offset(timing.endOfTurnAt, t0)}, transcript delay ${
      timing.transcriptionDelayMs === undefined ? "n/a" : Math.round(timing.transcriptionDelayMs)
    }`,
    llmPart,
    ttsPart,
    `speaking ${offset(timing.agentSpeakingAt, t0)}`,
    `llm calls ${timing.llmCalls.length}, tts calls ${timing.ttsCalls.length}`,
    // Wall-clock time zero, to line up with the browser's log (FLU-72).
    `t0 ${Math.round(t0)}`,
  ].join(" | ");
}

// Passes a stream through, calling onFirst at the first chunk that `counts`.
function watchFirst<T>(
  stream: ReadableStream<T>,
  counts: (chunk: T) => boolean,
  onFirst: () => void,
): ReadableStream<T> {
  let seen = false;
  return stream.pipeThrough(
    new TransformStream<T, T>({
      transform(chunk, controller) {
        if (!seen && counts(chunk)) {
          seen = true;
          onFirst();
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

// RMS level of a 16-bit PCM frame in dBFS, floored at -100, like rmsDbfs in lib/live-voice.ts.
export function frameDbfs(samples: Int16Array): number {
  if (samples.length === 0) return -100;
  let sum = 0;
  for (const sample of samples) sum += (sample / 32768) ** 2;
  const dbfs = 10 * Math.log10(sum / samples.length);
  return Number.isFinite(dbfs) && dbfs > -100 ? dbfs : -100;
}

function hasText(chunk: unknown): boolean {
  if (typeof chunk === "string") return chunk.length > 0;
  return typeof chunk === "object" && chunk !== null && "id" in chunk
    ? llm.hasResponse(chunk as llm.ChatChunk)
    : false;
}

// The tutor agent with its LLM and TTS calls timed. Each call runs exactly as the default node.
export class TimedAgent extends voice.Agent {
  // A plain field, not a parameter property: Node's type stripping can't run those.
  protected readonly timeline: TurnTimeline;

  constructor(options: voice.AgentOptions<unknown>, timeline: TurnTimeline) {
    super(options);
    this.timeline = timeline;
  }

  override async sttNode(
    audio: ReadableStream<AudioFrame> | AsyncIterable<AudioFrame>,
    modelSettings: voice.ModelSettings,
  ) {
    // Flux's word times count from the start of its audio, which is when the first frame came in.
    let audioStartedAt: number | undefined;
    const input = watchFirst(
      audio instanceof ReadableStream ? audio : ReadableStream.from(audio),
      () => true,
      () => {
        audioStartedAt = Date.now();
      },
    );
    const events = await voice.Agent.default.sttNode(this, input, modelSettings);
    if (!events) return events;
    const timeline = this.timeline;
    return events.pipeThrough(
      new TransformStream<stt.SpeechEvent | string, stt.SpeechEvent | string>({
        transform(event, controller) {
          if (typeof event !== "string" && event.type === stt.SpeechEventType.FINAL_TRANSCRIPT) {
            const end = event.alternatives?.[0].words?.at(-1)?.endTime;
            if (end !== undefined && end > 0 && audioStartedAt !== undefined) {
              timeline.lastWordEnded(audioStartedAt + end * 1000);
            }
          }
          controller.enqueue(event);
        },
      }),
    );
  }

  override async llmNode(
    chatCtx: llm.ChatContext,
    toolCtx: llm.ToolContext,
    modelSettings: voice.ModelSettings,
  ) {
    const call = this.timeline.llmStarted();
    const stream = await voice.Agent.default.llmNode(this, chatCtx, toolCtx, modelSettings);
    if (!stream) return stream;
    return watchFirst(stream, hasText, () => {
      call.firstOutputAt = Date.now();
    });
  }

  override async ttsNode(
    text: ReadableStream<string> | AsyncIterable<string>,
    modelSettings: voice.ModelSettings,
  ) {
    const call = this.timeline.ttsStarted();
    const input = watchFirst(
      text instanceof ReadableStream ? text : ReadableStream.from(text),
      (chunk) => chunk.trim().length > 0,
      () => {
        call.firstInputAt = Date.now();
      },
    );
    const audio = await voice.Agent.default.ttsNode(this, input, modelSettings);
    if (!audio) return audio;
    const timed = watchFirst<AudioFrame>(
      audio,
      () => true,
      () => {
        call.firstOutputAt = Date.now();
      },
    );
    return watchFirst<AudioFrame>(
      timed,
      (frame) => frameDbfs(frame.data) > AGENT_AUDIO_DBFS,
      () => {
        call.firstAudibleAt = Date.now();
      },
    );
  }
}
