"use server";

import { generateText } from "@/lib/ai";
import { countDueCards, getCard, nextDueCard, recentLatencies, recordReview } from "@/lib/cards";
import { getDb } from "@/lib/db";
import {
  checkAnswer,
  gradeReview,
  latencyThresholds,
  scheduleReview,
  type AnswerMode,
  type AnswerResult,
  type ReviewRating,
} from "@/lib/fsrs";
import { getLearner } from "@/lib/learner";
import { isUuid } from "@/lib/learner-id";
import { resolveProvider } from "@/lib/provider";
import {
  blankSentence,
  buildReviewInput,
  maskItem,
  parseReviewSentence,
  REVIEW_SENTENCE_PROMPT,
} from "@/lib/review";

export type ReviewCard = {
  status: "ready";
  cardId: string;
  prompt: string;
  cloze: string | null;
  due: number;
};

export async function startReview(): Promise<
  { status: "empty" } | ReviewCard | { status: "error" }
> {
  try {
    const learner = await getLearner();
    const db = getDb();
    const now = new Date();
    const card = await nextDueCard(db, learner.learnerId, now);
    if (!card) {
      return { status: "empty" };
    }

    let cloze: string | null = null;
    const selected = resolveProvider();
    if (!("error" in selected)) {
      try {
        const text = await generateText(selected, {
          model: "conversation",
          label: "review",
          // The conversation model's thinking counts toward this; parseReviewSentence validates the output.
          maxTokens: 1000,
          system: REVIEW_SENTENCE_PROMPT,
          messages: [
            {
              role: "user",
              content: buildReviewInput(card, learner.cefrSpeaking),
            },
          ],
        });
        cloze = parseReviewSentence(text, card.targetItem);
      } catch (error) {
        console.error("Could not write a review sentence.", error);
      }
    }

    if (!cloze) {
      cloze = card.sourceContextSentence
        ? blankSentence(card.sourceContextSentence, card.targetItem)
        : null;
    }

    const due = await countDueCards(db, learner.learnerId, now);

    return {
      status: "ready",
      cardId: card.cardId,
      prompt: maskItem(card.nativeTranslation, card.targetItem),
      cloze,
      due,
    };
  } catch (error) {
    console.error("Could not start a review.", error);
    return { status: "error" };
  }
}

export type ReviewResult = {
  status: "graded";
  result: AnswerResult;
  rating: ReviewRating;
  expected: string;
};

export async function submitReview(
  cardId: unknown,
  answer: unknown,
  mode: unknown,
  latencyMs: unknown,
  cloze: unknown,
): Promise<ReviewResult | { status: "error" }> {
  if (
    !isUuid(cardId) ||
    typeof answer !== "string" ||
    answer.length > 200 ||
    (mode !== "typed" && mode !== "spoken") ||
    typeof latencyMs !== "number" ||
    !Number.isInteger(latencyMs) ||
    latencyMs < 0 ||
    latencyMs > 600_000 ||
    (cloze !== null && (typeof cloze !== "string" || cloze.length > 500))
  ) {
    return { status: "error" };
  }

  try {
    const learner = await getLearner();
    const db = getDb();
    const card = await getCard(db, { learnerId: learner.learnerId, cardId });
    if (!card) {
      return { status: "error" };
    }

    const result = checkAnswer(card.targetItem, answer);
    const thresholds = latencyThresholds(
      mode as AnswerMode,
      await recentLatencies(db, learner.learnerId, mode as AnswerMode),
    );
    const rating = gradeReview(result, latencyMs, thresholds);
    const { card: schedule, log } = scheduleReview(
      card,
      rating,
      new Date(),
      learner.fsrsParameters,
    );

    await recordReview(db, {
      learnerId: learner.learnerId,
      cardId,
      schedule,
      log: {
        ...log,
        answerMode: mode as AnswerMode,
        responseLatencyMs: latencyMs,
        generatedReviewSentence: cloze,
      },
    });

    return {
      status: "graded",
      result,
      rating,
      expected: card.targetItem,
    };
  } catch (error) {
    console.error("Could not record the review.", error);
    return { status: "error" };
  }
}
