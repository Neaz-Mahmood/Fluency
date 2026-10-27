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
import {
  END_REASON_ATTRIBUTE,
  REMAINING_SECONDS_ATTRIBUTE,
  REPLY_TURN_ID_ATTRIBUTE,
  SESSION_ID_ATTRIBUTE,
} from "@/lib/live-voice";
import { summarizePhrases } from "@/lib/pronunciation-score";
import { savePronunciationScore } from "@/lib/pronunciation-store";
import { saveExchange, startSession } from "@/lib/sessions";
import { loadVoiceContext } from "./context";
import {
  AGENT_NAME,
  EAGER_EOT_THRESHOLD,
  ExchangeCollector,
  LLM_MODEL,
  parseJobMetadata,
  QUOTA_GOODBYE,
  STT_MODEL,
  TTS_LANGUAGE,
  TTS_MODEL,
  TTS_VOICE_KATIE,
  type VoiceExchange,
} from "./job";
import { startVoiceMeter, type VoiceLimit } from "./meter";
import {
  assessScripted,
  azureConfigFromEnv,
  ScoringAgent,
  type AzureConfig,
} from "./pronunciation";
import { formatTimeline, TimedAgent, TurnTimeline } from "./timeline";
import {
  concatPcm,
  pcmDurationMs,
  SCORING_DRAIN_MS,
  shouldScore,
  TurnAudioBuffer,
} from "./turn-audio";

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

    const azure = azureConfigFromEnv();
    if (!azure) {
      console.log(
        "[voice] pronunciation scoring off: AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is not set",
      );
    }
    // The learner's audio for scoring, in memory only (doc/voice-worker.md, Pronunciation).
    const turnAudio = azure ? new TurnAudioBuffer() : null;

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
        modelOptions: { speed: context.ttsSpeed },
      }),
      turnHandling: { preemptiveGeneration: { enabled: true } },
    });

    let sessionId = context.sessionId;
    const collector = new ExchangeCollector();
    let saving = Promise.resolve();
    let scoring = Promise.resolve();
    let pendingAudio: Int16Array[] = [];
    let lastEndOfTurnDelay: number | undefined;
    let lastStoppedSpeakingAt: number | undefined;
    let lastTranscriptionDelay: number | undefined;
    const timeline = new TurnTimeline();

    // Returns the session the exchange was saved into, or null when saving failed.
    const save = async (exchange: VoiceExchange, userTurnId: string): Promise<string | null> => {
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
        const replyTurnId = crypto.randomUUID();
        await saveExchange(db, {
          sessionId,
          userText: exchange.userText,
          inputMode: "voice",
          replyText: exchange.replyText,
          replyTurnId,
          userTurnId,
          firstTokenMs: exchange.firstTokenMs ?? 0,
        });
        // Lets the browser attach its latency measurement to this reply (hooks/useLiveVoice.ts).
        ctx.room.localParticipant
          ?.setAttributes({ [REPLY_TURN_ID_ATTRIBUTE]: replyTurnId })
          .catch((error: unknown) => console.error("Could not announce the reply turn id:", error));
        return sessionId;
      } catch (error) {
        console.error("Could not save exchange:", error);
        return null;
      }
    };

    const score = async (
      config: AzureConfig,
      scoredSessionId: string,
      turnId: string,
      userText: string,
      pcm: Int16Array,
    ) => {
      const startedAt = performance.now();
      try {
        const phrases = await assessScripted(pcm, userText, config);
        if (phrases.length === 0) {
          console.log("[voice] pronunciation: nothing recognized");
          return;
        }
        const audioMs = pcmDurationMs(pcm.length);
        const scores = summarizePhrases(phrases);
        await savePronunciationScore(db, {
          turnId,
          sessionId: scoredSessionId,
          learnerId: job.learnerId,
          audioMs,
          ...scores,
        });
        console.log(
          `[voice] pronunciation: ${audioMs} ms scored in ${Math.round(performance.now() - startedAt)} ms, accuracy ${scores.accuracy ?? "n/a"}, ${scores.mismatches.length} mismatches`,
        );
      } catch (error) {
        console.error("Could not score pronunciation:", error);
      }
    };

    // Saves the exchange, then scores its learner turn on a separate chain that no reply waits for.
    const emit = (exchange: VoiceExchange) => {
      const userTurnId = crypto.randomUUID();
      const audio = concatPcm(pendingAudio);
      pendingAudio = [];

      const saved = saving.then(() => save(exchange, userTurnId));
      saving = saved.then(() => undefined);

      if (azure && shouldScore(exchange.userText, pcmDurationMs(audio.length))) {
        scoring = scoring.then(async () => {
          const savedSessionId = await saved;
          if (!savedSessionId) return;
          await score(azure, savedSessionId, userTurnId, exchange.userText, audio);
        });
      }
    };

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      const item = ev.item;
      if (item.type !== "message" || !item.role) return;

      // LiveKit puts the end-of-turn delay on the learner's message, the rest on the reply.
      if (item.role === "user") {
        lastEndOfTurnDelay = item.metrics?.endOfTurnDelay;
        lastStoppedSpeakingAt = item.metrics?.stoppedSpeakingAt;
        lastTranscriptionDelay = item.metrics?.transcriptionDelay;
        if (turnAudio) {
          // LiveKit gives the speaking times in seconds.
          const { startedSpeakingAt, stoppedSpeakingAt } = item.metrics ?? {};
          const audio = turnAudio.take(
            startedSpeakingAt === undefined ? undefined : startedSpeakingAt * 1000,
            stoppedSpeakingAt === undefined ? undefined : stoppedSpeakingAt * 1000,
          );
          if (audio.length > 0) pendingAudio.push(audio);
        }
      }
      if (item.role === "assistant") {
        const { llmNodeTtft, ttsNodeTtfb, e2eLatency } = item.metrics ?? {};
        console.log(
          `[voice] endOfTurn ${ms(lastEndOfTurnDelay)}, llmTtft ${ms(llmNodeTtft)}, ttsTtfb ${ms(ttsNodeTtfb)}, e2e ${ms(e2eLatency)}`,
        );
        const calls = timeline.take();
        if (
          lastStoppedSpeakingAt !== undefined &&
          lastEndOfTurnDelay !== undefined &&
          e2eLatency !== undefined
        ) {
          console.log(
            formatTimeline({
              stoppedSpeakingAt: lastStoppedSpeakingAt * 1000,
              endOfTurnAt: (lastStoppedSpeakingAt + lastEndOfTurnDelay) * 1000,
              agentSpeakingAt: (lastStoppedSpeakingAt + e2eLatency) * 1000,
              transcriptionDelayMs:
                lastTranscriptionDelay === undefined ? undefined : lastTranscriptionDelay * 1000,
              ...calls,
            }),
          );
        }
      }

      const exchange = collector.add({
        role: item.role,
        text: item.textContent ?? "",
        llmTtftSeconds: item.metrics?.llmNodeTtft,
      });

      if (exchange) emit(exchange);
    });

    let meter: ReturnType<typeof startVoiceMeter> | null = null;
    ctx.addShutdownCallback(async () => {
      // Records the session's last seconds before the final save.
      await meter?.stop();
      const flushed = collector.flush();
      if (flushed) emit(flushed);
      await saving;

      // Gives turns still being scored a little time, without holding the shutdown up for long.
      let drainTimer: NodeJS.Timeout | undefined;
      await Promise.race([
        scoring,
        new Promise<void>((resolve) => {
          drainTimer = setTimeout(resolve, SCORING_DRAIN_MS);
        }),
      ]);
      clearTimeout(drainTimer);
    });

    await session.start({
      agent: turnAudio
        ? new ScoringAgent({ instructions: context.instructions, chatCtx }, timeline, turnAudio)
        : new TimedAgent({ instructions: context.instructions, chatCtx }, timeline),
      room: ctx.room,
      // Turns off LiveKit's default recording: it writes session audio to disk and uploads audio,
      // transcript and traces to LiveKit Cloud. Fluency stores no raw audio (doc/voice-path.md).
      record: false,
    });
    await ctx.connect();

    // Lets the browser warn in the last minute (hooks/useLiveVoice.ts).
    const announceRemaining = (seconds: number) => {
      ctx.room.localParticipant
        ?.setAttributes({ [REMAINING_SECONDS_ATTRIBUTE]: String(seconds) })
        .catch((error: unknown) => console.error("Could not announce remaining seconds:", error));
    };
    announceRemaining(context.remainingSeconds);

    let limitEnded = false;
    // Out of time: a goodbye, then the room is deleted so the learner's mic stops too.
    // Consent withdrawn: no goodbye, the voice stops at once.
    const endForLimit = async (limit: VoiceLimit) => {
      if (limitEnded) return;
      limitEnded = true;

      try {
        await ctx.room.localParticipant?.setAttributes({ [END_REASON_ATTRIBUTE]: limit });
      } catch (error) {
        console.error("Could not set end reason attribute:", error);
      }

      if (limit === "quota") {
        try {
          await session.say(QUOTA_GOODBYE, { allowInterruptions: false }).waitForPlayout();
        } catch (error) {
          console.error("Could not play quota goodbye:", error);
        }
      }

      // Logged first: deleting the room shuts this job down.
      console.log(`[voice] ending: ${limit}`);
      try {
        await ctx.deleteRoom();
      } catch (error) {
        console.error("Could not delete room:", error);
        ctx.shutdown(limit);
      }
    };

    meter = startVoiceMeter({
      db,
      learnerId: job.learnerId,
      remainingSeconds: context.remainingSeconds,
      onTick: announceRemaining,
      onLimit: (limit) => void endForLimit(limit),
    });

    // No greeting: as in text chat, the learner speaks first.
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));
