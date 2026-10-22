"use server";

import { generateText } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { getLearner, setPlacementLevels } from "@/lib/learner";
import { isUuid } from "@/lib/learner-id";
import {
  ASSESSMENT_PROMPT,
  formatPlacementTranscript,
  parseAssessment,
  type CefrLevel,
} from "@/lib/placement";
import { resolveProvider } from "@/lib/provider";
import { endSession, findOpenSession, loadTurns } from "@/lib/sessions";

export type PlacementResult =
  | { status: "done"; speaking: CefrLevel; writing: CefrLevel }
  | { status: "error" };

// Assesses an English learner's level from their placement chat and writes provisional levels.
export async function finishPlacement(sessionId: unknown): Promise<PlacementResult> {
  if (!isUuid(sessionId)) {
    return { status: "error" };
  }

  try {
    const learner = await getLearner();
    const db = getDb();
    const session = await findOpenSession(db, {
      learnerId: learner.learnerId,
      sessionId,
      mode: "placement",
    });
    if (!session) {
      return { status: "error" };
    }

    const turns = await loadTurns(db, sessionId);
    const hasUserTurn = turns.some((turn) => turn.role === "user");
    if (!hasUserTurn) {
      return { status: "error" };
    }

    const selected = resolveProvider();
    if ("error" in selected) {
      return { status: "error" };
    }

    const text = await generateText(selected, {
      model: "feedback",
      // The feedback model's thinking counts toward this; parseAssessment validates the output.
      maxTokens: 1000,
      system: ASSESSMENT_PROMPT,
      messages: [{ role: "user", content: formatPlacementTranscript(turns) }],
    });

    const levels = parseAssessment(text);
    if (!levels) {
      console.error("Could not parse placement assessment.", text);
      return { status: "error" };
    }

    await setPlacementLevels(db, learner.learnerId, levels);
    await endSession(db, { learnerId: learner.learnerId, sessionId });

    return { status: "done", speaking: levels.speaking, writing: levels.writing };
  } catch (error) {
    console.error("Could not finish placement.", error);
    return { status: "error" };
  }
}
