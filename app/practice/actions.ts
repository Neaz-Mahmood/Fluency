"use server";

import { after } from "next/server";

import { generateText } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { getLearner, setTutorSummary } from "@/lib/learner";
import { isUuid } from "@/lib/learner-id";
import { resolveProvider } from "@/lib/provider";
import {
  endSession,
  findOpenSession,
  loadTurns,
  recordFirstAudio as persistFirstAudio,
} from "@/lib/sessions";
import { buildSummaryInput, capSummary, SUMMARY_PROMPT } from "@/lib/summary";

const MAX_FIRST_AUDIO_MS = 120_000;

export async function endConversation(sessionId: unknown): Promise<void> {
  if (!isUuid(sessionId)) {
    return;
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
      return;
    }

    const ended = await endSession(db, { learnerId: learner.learnerId, sessionId });
    if (!ended) {
      return;
    }

    after(async () => {
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
    });
  } catch (error) {
    console.error("Could not end the conversation session.", error);
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
