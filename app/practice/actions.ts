"use server";

import { getDb } from "@/lib/db";
import { getLearner } from "@/lib/learner";
import { isUuid } from "@/lib/learner-id";
import { recordFirstAudio as persistFirstAudio } from "@/lib/sessions";

const MAX_FIRST_AUDIO_MS = 120_000;

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
