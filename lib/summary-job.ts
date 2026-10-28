import "server-only";

import { generateText } from "@/lib/ai";
import { getDb } from "@/lib/db";
import type { LearnerProfile } from "@/lib/db/schema";
import { setTutorSummary } from "@/lib/learner";
import { resolveProvider } from "@/lib/provider";
import { loadTurns } from "@/lib/sessions";
import { buildSummaryInput, capSummary, SUMMARY_PROMPT } from "@/lib/summary";

// Rebuilds the tutor's private note about the learner from a finished session.
export async function runSummary(learner: LearnerProfile, sessionId: string): Promise<void> {
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
      label: "summary",
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
