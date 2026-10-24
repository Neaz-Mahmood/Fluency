"use server";

import { saveCard } from "@/lib/cards";
import { getDb } from "@/lib/db";
import { getFeedback } from "@/lib/feedback-store";
import { getLearner } from "@/lib/learner";
import { isUuid } from "@/lib/learner-id";

export type SaveTarget =
  { kind: "edit"; item: number; edit: number } | { kind: "word"; index: number };

function isSaveTarget(target: unknown): target is SaveTarget {
  if (typeof target !== "object" || target === null) {
    return false;
  }
  const t = target as Record<string, unknown>;
  if (t.kind === "edit") {
    return (
      typeof t.item === "number" &&
      Number.isInteger(t.item) &&
      t.item >= 0 &&
      typeof t.edit === "number" &&
      Number.isInteger(t.edit) &&
      t.edit >= 0
    );
  }
  if (t.kind === "word") {
    return typeof t.index === "number" && Number.isInteger(t.index) && t.index >= 0;
  }
  return false;
}

export async function saveRecapCard(
  sessionId: unknown,
  target: unknown,
): Promise<{ status: "saved" | "error" }> {
  try {
    if (!isUuid(sessionId) || !isSaveTarget(target)) {
      return { status: "error" };
    }

    const learner = await getLearner();
    const feedback = await getFeedback(getDb(), {
      learnerId: learner.learnerId,
      sessionId,
    });

    if (!feedback || feedback.status !== "done") {
      return { status: "error" };
    }

    if (target.kind === "edit") {
      const item = feedback.items[target.item];
      const edit = item?.edits[target.edit];
      if (!item || !edit || edit.correction.trim() === "") {
        return { status: "error" };
      }

      await saveCard(getDb(), {
        learnerId: learner.learnerId,
        cardType: "GRAMMAR_PATTERN",
        targetItem: edit.correction.trim(),
        nativeTranslation: item.explanation,
        sourceContextSentence: item.minimalCorrection,
      });
    } else {
      const word = feedback.vocabulary[target.index];
      if (!word) {
        return { status: "error" };
      }

      await saveCard(getDb(), {
        learnerId: learner.learnerId,
        cardType: "VOCABULARY",
        targetItem: word.item,
        nativeTranslation: word.meaning,
        sourceContextSentence: word.example,
      });
    }

    return { status: "saved" };
  } catch (error) {
    console.error("Could not save the flashcard.", error);
    return { status: "error" };
  }
}
