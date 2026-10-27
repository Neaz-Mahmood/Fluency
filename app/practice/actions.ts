"use server";

import { after } from "next/server";

import { generateText } from "@/lib/ai";
import { getDb } from "@/lib/db";
import type { LearnerProfile } from "@/lib/db/schema";
import { runFeedback } from "@/lib/feedback-job";
import { markFeedbackPending } from "@/lib/feedback-store";
import { getLearner, setTutorSummary } from "@/lib/learner";
import { isUuid } from "@/lib/learner-id";
import { runPronunciationFeedback } from "@/lib/pronunciation-job";
import { markPronunciationPending } from "@/lib/pronunciation-store";
import { resolveProvider } from "@/lib/provider";
import {
  endSession,
  findOpenSession,
  loadTurns,
  recordFirstAudio as persistFirstAudio,
  recordSpeechEndToAudio,
} from "@/lib/sessions";
import { MAX_LIVE_LATENCY_MS } from "@/lib/live-voice";
import { buildSummaryInput, capSummary, SUMMARY_PROMPT } from "@/lib/summary";

const MAX_FIRST_AUDIO_MS = 120_000;

async function buildSummary(learner: LearnerProfile, sessionId: string): Promise<void> {
  try {
    const turns = await loadTurns(getDb(), sessionId);
    const hasUserTurn = turns.some((turn) => turn.role === "user");
    if (!hasUserTurn) {
      return;
    }

    const selected = resolveProvider();
    if ("error" in selected) {
      return;
    }

    const text = await generateText(selected, {
      model: "feedback",
      // The feedback model's thinking counts toward this; capSummary bounds the stored note.
      maxTokens: 1000,
      system: SUMMARY_PROMPT,
      messages: [{ role: "user", content: buildSummaryInput(learner, turns) }],
    });

    const summary = capSummary(text);
    if (summary) {
      await setTutorSummary(getDb(), learner.learnerId, summary);
    }
  } catch (error) {
    console.error("Could not build the learner summary.", error);
  }
}

export async function endConversation(sessionId: unknown): Promise<boolean> {
  if (!isUuid(sessionId)) {
    return false;
  }

  try {
    const learner = await getLearner();
    const db = getDb();
    const session = await findOpenSession(db, {
      learnerId: learner.learnerId,
      sessionId,
      mode: "conversation",
    });
    if (!session) {
      return false;
    }

    const ended = await endSession(db, { learnerId: learner.learnerId, sessionId });
    if (!ended) {
      return false;
    }

    await markFeedbackPending(db, { learnerId: learner.learnerId, sessionId });

    // Live voice turns are scored in the background; their recap waits for the scores (FLU-65).
    const spoken = (await loadTurns(db, sessionId)).some(
      (turn) => turn.role === "user" && turn.inputMode === "voice",
    );
    if (spoken) {
      await markPronunciationPending(db, { learnerId: learner.learnerId, sessionId });
    }

    after(async () => {
      await Promise.allSettled([
        buildSummary(learner, sessionId),
        runFeedback(learner, sessionId, "conversation"),
        ...(spoken ? [runPronunciationFeedback(learner, sessionId)] : []),
      ]);
    });
    return true;
  } catch (error) {
    console.error("Could not end the conversation session.", error);
    return false;
  }
}

export async function recordFirstAudio(turnId: unknown, firstAudioMs: unknown): Promise<void> {
  if (
    !isUuid(turnId) ||
    typeof firstAudioMs !== "number" ||
    !Number.isInteger(firstAudioMs) ||
    firstAudioMs < 0 ||
    firstAudioMs > MAX_FIRST_AUDIO_MS
  ) {
    return;
  }

  try {
    const learner = await getLearner();
    const recorded = await persistFirstAudio(getDb(), {
      learnerId: learner.learnerId,
      turnId,
      firstAudioMs,
    });
    if (!recorded) {
      // shortcut: the reply may still be saving in after(); one retry covers it. Upgrade to a queue if misses show up.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await persistFirstAudio(getDb(), {
        learnerId: learner.learnerId,
        turnId,
        firstAudioMs,
      });
    }
  } catch (error) {
    console.error("Could not record first audio latency.", error);
  }
}

export async function recordLiveVoiceLatency(
  turnId: unknown,
  speechEndToAudioMs: unknown,
): Promise<void> {
  if (
    !isUuid(turnId) ||
    typeof speechEndToAudioMs !== "number" ||
    !Number.isInteger(speechEndToAudioMs) ||
    speechEndToAudioMs < 0 ||
    speechEndToAudioMs > MAX_LIVE_LATENCY_MS
  ) {
    return;
  }

  try {
    const learner = await getLearner();
    await recordSpeechEndToAudio(getDb(), {
      learnerId: learner.learnerId,
      turnId,
      speechEndToAudioMs,
    });
  } catch (error) {
    console.error("Could not record live voice latency.", error);
  }
}
