"use server";

import { after } from "next/server";

import { getDb } from "@/lib/db";
import { getLearner } from "@/lib/learner";
import { isUuid } from "@/lib/learner-id";
import { MAX_LIVE_LATENCY_MS } from "@/lib/live-voice";
import { finishConversation, runConversationJobs } from "@/lib/session-end";
import {
  findOpenSession,
  recordFirstAudio as persistFirstAudio,
  recordSpeechEndToAudio,
} from "@/lib/sessions";

const MAX_FIRST_AUDIO_MS = 120_000;

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

    const finished = await finishConversation(db, learner, sessionId);
    if (!finished) {
      return false;
    }
    after(() => runConversationJobs(learner, sessionId, finished));
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
