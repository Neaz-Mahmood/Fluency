import { fileURLToPath } from "node:url";

import {
  ServerOptions,
  cli,
  defineAgent,
  inference,
  llm,
  voice,
  type JobContext,
} from "@livekit/agents";

import { getDb } from "@/lib/db";
import { SESSION_ID_ATTRIBUTE } from "@/lib/live-voice";
import { saveExchange, startSession } from "@/lib/sessions";
import { loadVoiceContext } from "./context";
import {
  AGENT_NAME,
  EAGER_EOT_THRESHOLD,
  ExchangeCollector,
  LLM_MODEL,
  parseJobMetadata,
  STT_MODEL,
  TTS_LANGUAGE,
  TTS_MODEL,
  TTS_VOICE_KATIE,
  type VoiceExchange,
} from "./job";

// LiveKit reports latencies in seconds.
function ms(seconds: number | undefined): string {
  return seconds !== undefined && Number.isFinite(seconds)
    ? `${Math.round(seconds * 1000)} ms`
    : "n/a";
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const job = parseJobMetadata(ctx.job.metadata);
    if ("error" in job) {
      console.error(`Invalid job metadata: ${job.error}`);
      return;
    }

    const db = getDb();
    const context = await loadVoiceContext(db, job, new Date());
    if ("error" in context) {
      console.error(`Could not load voice context: ${context.error}`);
      return;
    }

    const chatCtx = llm.ChatContext.empty();
    for (const turn of context.history) {
      chatCtx.addMessage({ role: turn.role, content: turn.content });
    }

    const session = new voice.AgentSession({
      stt: new inference.STT({
        model: STT_MODEL,
        modelOptions: { eager_eot_threshold: EAGER_EOT_THRESHOLD },
      }),
      llm: new inference.LLM({ model: LLM_MODEL }),
      tts: new inference.TTS({
        model: TTS_MODEL,
        voice: TTS_VOICE_KATIE,
        language: TTS_LANGUAGE,
      }),
      turnHandling: { preemptiveGeneration: { enabled: true } },
    });

    let sessionId = context.sessionId;
    const collector = new ExchangeCollector();
    let saving = Promise.resolve();
    let lastEndOfTurnDelay: number | undefined;

    const save = async (exchange: VoiceExchange) => {
      try {
        if (!sessionId) {
          const created = await startSession(db, {
            learnerId: job.learnerId,
            mode: "conversation",
            scenarioId: job.scenarioId,
          });
          sessionId = created.sessionId;
          // Tells the browser which session it is in, for Finish and reloads (hooks/useLiveVoice.ts).
          ctx.room.localParticipant
            ?.setAttributes({ [SESSION_ID_ATTRIBUTE]: sessionId })
            .catch((error: unknown) => console.error("Could not announce the session id:", error));
        }
        await saveExchange(db, {
          sessionId,
          userText: exchange.userText,
          inputMode: "voice",
          replyText: exchange.replyText,
          replyTurnId: crypto.randomUUID(),
          firstTokenMs: exchange.firstTokenMs ?? 0,
        });
      } catch (error) {
        console.error("Could not save exchange:", error);
      }
    };

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      const item = ev.item;
      if (item.type !== "message" || !item.role) return;

      // LiveKit puts the end-of-turn delay on the learner's message, the rest on the reply.
      if (item.role === "user") lastEndOfTurnDelay = item.metrics?.endOfTurnDelay;
      if (item.role === "assistant") {
        const { llmNodeTtft, ttsNodeTtfb, e2eLatency } = item.metrics ?? {};
        console.log(
          `[voice] endOfTurn ${ms(lastEndOfTurnDelay)}, llmTtft ${ms(llmNodeTtft)}, ttsTtfb ${ms(ttsNodeTtfb)}, e2e ${ms(e2eLatency)}`,
        );
      }

      const exchange = collector.add({
        role: item.role,
        text: item.textContent ?? "",
        llmTtftSeconds: item.metrics?.llmNodeTtft,
      });

      if (exchange) {
        saving = saving.then(() => save(exchange));
      }
    });

    ctx.addShutdownCallback(async () => {
      const flushed = collector.flush();
      if (flushed) {
        saving = saving.then(() => save(flushed));
      }
      await saving;
    });

    await session.start({
      agent: new voice.Agent({ instructions: context.instructions, chatCtx }),
      room: ctx.room,
      // Turns off LiveKit's default recording: it writes session audio to disk and uploads audio,
      // transcript and traces to LiveKit Cloud. Fluency stores no raw audio (doc/voice-path.md).
      record: false,
    });
    await ctx.connect();

    // No greeting: as in text chat, the learner speaks first.
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));
