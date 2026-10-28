import "server-only";

import { generateText } from "@/lib/ai";
import { getDb } from "@/lib/db";
import type { LearnerProfile, StoredFeedbackItem } from "@/lib/db/schema";
import {
  buildFeedbackInput,
  buildFeedbackSystemPrompt,
  explanationLanguage,
  parseFeedback,
  splitSentences,
  type FeedbackLine,
} from "@/lib/feedback";
import { markFeedbackFailed, recordErrorPatterns, saveFeedback } from "@/lib/feedback-store";
import { resolveProvider } from "@/lib/provider";
import { loadTurns } from "@/lib/sessions";

export async function runFeedback(
  learner: Pick<LearnerProfile, "learnerId" | "nativeLanguage" | "cefrSpeaking">,
  sessionId: string,
  mode: "conversation" | "writing",
): Promise<void> {
  try {
    const db = getDb();
    const turns = await loadTurns(db, sessionId);

    const lines: FeedbackLine[] = [];
    const lineTurns: (typeof turns)[number][] = [];

    if (mode === "conversation") {
      for (const turn of turns) {
        lines.push({
          role: turn.role,
          content: turn.content,
          inputMode: turn.inputMode,
        });
        lineTurns.push(turn);
      }
    } else {
      for (const turn of turns) {
        if (turn.role !== "user") {
          continue;
        }
        const sentences = splitSentences(turn.content);
        for (const sentence of sentences) {
          lines.push({
            role: "user",
            content: sentence,
            inputMode: "typed",
          });
          lineTurns.push(turn);
        }
      }
    }

    const { input, learnerLines, learnerIndexes } = buildFeedbackInput(lines);
    if (learnerLines.length === 0) {
      await saveFeedback(db, {
        learnerId: learner.learnerId,
        sessionId,
        items: [],
        vocabulary: [],
      });
      return;
    }

    const selected = resolveProvider();
    if ("error" in selected) {
      console.error("Could not build session feedback.", selected.error);
      await markFeedbackFailed(db, { learnerId: learner.learnerId, sessionId });
      return;
    }

    const text = await generateText(selected, {
      model: "feedback",
      label: `feedback-${mode}`,
      // The feedback model's thinking counts toward this, and a long session can return many items.
      maxTokens: 4000,
      system: buildFeedbackSystemPrompt(explanationLanguage(learner)),
      messages: [{ role: "user", content: input }],
    });

    const feedback = parseFeedback(text, learnerLines);
    if (!feedback) {
      console.error("Could not parse session feedback.", text);
      await markFeedbackFailed(db, { learnerId: learner.learnerId, sessionId });
      return;
    }

    const stored: StoredFeedbackItem[] = feedback.items.map((item) => {
      const turn = lineTurns[learnerIndexes[item.line - 1]!]!;
      return {
        ...item,
        turnId: turn.id,
        original: learnerLines[item.line - 1]!,
        inputMode: turn.inputMode,
      };
    });

    await saveFeedback(db, {
      learnerId: learner.learnerId,
      sessionId,
      items: stored,
      vocabulary: feedback.vocabulary,
    });

    const modalities = Array.from(
      new Set(
        learnerIndexes.map((idx) =>
          lines[idx]?.inputMode === "voice"
            ? ("SPEAKING_GRAMMAR" as const)
            : ("WRITING_GRAMMAR" as const),
        ),
      ),
    );

    await recordErrorPatterns(db, {
      learnerId: learner.learnerId,
      items: stored,
      modalities,
    });
  } catch (error) {
    console.error("Could not build session feedback.", error);
    try {
      const db = getDb();
      await markFeedbackFailed(db, { learnerId: learner.learnerId, sessionId });
    } catch (failedError) {
      console.error("Could not mark feedback as failed.", failedError);
    }
  }
}
