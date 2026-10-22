import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  countDueCards,
  dueCardItems,
  getCard,
  nextDueCard,
  recentLatencies,
  recordReview,
  saveCard,
  savedTargetItems,
} from "@/lib/cards";
import { fsrsCards, fsrsReviewLogs } from "@/lib/db/schema";
import type { CardSchedule } from "@/lib/fsrs";
import { ensureLearnerProfile } from "@/lib/learner";
import { newLearnerId } from "@/lib/learner-id";
import { createTestDb, resetTestDb } from "@/test/db";
import { TEST_DATABASE_URL } from "@/test/db-url";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const db = createTestDb();

beforeEach(async () => {
  await resetTestDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function newLearner() {
  return (await ensureLearnerProfile(db, newLearnerId())).learnerId;
}

describe("saveCard", () => {
  it("creates a card with state New and created: true, returns existing on duplicate, and allows different cardType", async () => {
    const learnerId = await newLearner();

    const first = await saveCard(db, {
      learnerId,
      cardType: "GRAMMAR_PATTERN",
      targetItem: "went",
      nativeTranslation: "Use past tense for completed actions.",
      sourceContextSentence: "I went home yesterday.",
    });

    expect(first.created).toBe(true);
    expect(first.card).toMatchObject({
      learnerId,
      cardType: "GRAMMAR_PATTERN",
      targetItem: "went",
      nativeTranslation: "Use past tense for completed actions.",
      sourceContextSentence: "I went home yesterday.",
      state: "New",
    });
    expect(first.card.cardId).toBeDefined();

    const second = await saveCard(db, {
      learnerId,
      cardType: "GRAMMAR_PATTERN",
      targetItem: "went",
      nativeTranslation: "Different translation",
      sourceContextSentence: "Different sentence",
    });

    expect(second.created).toBe(false);
    expect(second.card.cardId).toBe(first.card.cardId);

    const third = await saveCard(db, {
      learnerId,
      cardType: "VOCABULARY",
      targetItem: "went",
      nativeTranslation: "Past tense of go",
      sourceContextSentence: "He went to the market.",
    });

    expect(third.created).toBe(true);
    expect(third.card.cardId).not.toBe(first.card.cardId);
    expect(third.card.cardType).toBe("VOCABULARY");
    expect(third.card.targetItem).toBe("went");
  });
});

describe("savedTargetItems", () => {
  it("returns only this learner's saved items, and an empty set for an empty list", async () => {
    const learner1 = await newLearner();
    const learner2 = await newLearner();

    const empty = await savedTargetItems(db, learner1, []);
    expect(empty).toEqual(new Set());
    expect(empty.size).toBe(0);

    await saveCard(db, {
      learnerId: learner1,
      cardType: "VOCABULARY",
      targetItem: "apple",
      nativeTranslation: "আপেল",
      sourceContextSentence: "I ate an apple.",
    });

    await saveCard(db, {
      learnerId: learner1,
      cardType: "GRAMMAR_PATTERN",
      targetItem: "went",
      nativeTranslation: "Use past tense",
      sourceContextSentence: "I went home.",
    });

    await saveCard(db, {
      learnerId: learner2,
      cardType: "VOCABULARY",
      targetItem: "banana",
      nativeTranslation: "কলা",
      sourceContextSentence: "He likes banana.",
    });

    const saved = await savedTargetItems(db, learner1, ["apple", "went", "banana", "orange"]);
    expect(saved).toEqual(new Set(["apple", "went"]));

    const learner2Saved = await savedTargetItems(db, learner2, [
      "apple",
      "went",
      "banana",
      "orange",
    ]);
    expect(learner2Saved).toEqual(new Set(["banana"]));
  });
});

describe("nextDueCard", () => {
  it("returns the earliest due card, ignores cards due in the future and other learners' cards, and gives null when nothing is due", async () => {
    const learner1 = await newLearner();
    const learner2 = await newLearner();
    const now = new Date("2026-01-01T12:00:00Z");

    expect(await nextDueCard(db, learner1, now)).toBeNull();

    const c1 = await saveCard(db, {
      learnerId: learner1,
      cardType: "VOCABULARY",
      targetItem: "c1",
      nativeTranslation: "c1",
    });
    await db
      .update(fsrsCards)
      .set({ due: new Date("2026-01-01T11:50:00Z") })
      .where(eq(fsrsCards.cardId, c1.card.cardId));

    const c2 = await saveCard(db, {
      learnerId: learner1,
      cardType: "VOCABULARY",
      targetItem: "c2",
      nativeTranslation: "c2",
    });
    await db
      .update(fsrsCards)
      .set({ due: new Date("2026-01-01T11:40:00Z") })
      .where(eq(fsrsCards.cardId, c2.card.cardId));

    const c3 = await saveCard(db, {
      learnerId: learner1,
      cardType: "VOCABULARY",
      targetItem: "c3",
      nativeTranslation: "c3",
    });
    await db
      .update(fsrsCards)
      .set({ due: new Date("2026-01-01T12:10:00Z") })
      .where(eq(fsrsCards.cardId, c3.card.cardId));

    const c4 = await saveCard(db, {
      learnerId: learner2,
      cardType: "VOCABULARY",
      targetItem: "c4",
      nativeTranslation: "c4",
    });
    await db
      .update(fsrsCards)
      .set({ due: new Date("2026-01-01T11:30:00Z") })
      .where(eq(fsrsCards.cardId, c4.card.cardId));

    const result = await nextDueCard(db, learner1, now);
    expect(result).not.toBeNull();
    expect(result!.cardId).toBe(c2.card.cardId);

    const wayBack = new Date("2026-01-01T11:00:00Z");
    expect(await nextDueCard(db, learner1, wayBack)).toBeNull();
  });
});

describe("countDueCards", () => {
  it("counts only due cards", async () => {
    const learner1 = await newLearner();
    const learner2 = await newLearner();
    const now = new Date("2026-01-01T12:00:00Z");

    expect(await countDueCards(db, learner1, now)).toBe(0);

    const c1 = await saveCard(db, {
      learnerId: learner1,
      cardType: "VOCABULARY",
      targetItem: "c1",
      nativeTranslation: "c1",
    });
    await db
      .update(fsrsCards)
      .set({ due: new Date("2026-01-01T11:00:00Z") })
      .where(eq(fsrsCards.cardId, c1.card.cardId));

    const c2 = await saveCard(db, {
      learnerId: learner1,
      cardType: "VOCABULARY",
      targetItem: "c2",
      nativeTranslation: "c2",
    });
    await db
      .update(fsrsCards)
      .set({ due: new Date("2026-01-01T11:30:00Z") })
      .where(eq(fsrsCards.cardId, c2.card.cardId));

    const c3 = await saveCard(db, {
      learnerId: learner1,
      cardType: "VOCABULARY",
      targetItem: "c3",
      nativeTranslation: "c3",
    });
    await db
      .update(fsrsCards)
      .set({ due: new Date("2026-01-01T13:00:00Z") })
      .where(eq(fsrsCards.cardId, c3.card.cardId));

    const c4 = await saveCard(db, {
      learnerId: learner2,
      cardType: "VOCABULARY",
      targetItem: "c4",
      nativeTranslation: "c4",
    });
    await db
      .update(fsrsCards)
      .set({ due: new Date("2026-01-01T11:00:00Z") })
      .where(eq(fsrsCards.cardId, c4.card.cardId));

    expect(await countDueCards(db, learner1, now)).toBe(2);
    expect(await countDueCards(db, learner2, now)).toBe(1);

    const past = new Date("2026-01-01T10:00:00Z");
    expect(await countDueCards(db, learner1, past)).toBe(0);
  });
});

describe("dueCardItems", () => {
  it("returns only due items for that learner, earliest first, and respects limit", async () => {
    const learner1 = await newLearner();
    const learner2 = await newLearner();
    const now = new Date("2026-01-01T12:00:00Z");

    expect(await dueCardItems(db, learner1, now, 5)).toEqual([]);

    const c1 = await saveCard(db, {
      learnerId: learner1,
      cardType: "VOCABULARY",
      targetItem: "earlier-due",
      nativeTranslation: "meaning 1",
    });
    await db
      .update(fsrsCards)
      .set({ due: new Date("2026-01-01T11:50:00Z") })
      .where(eq(fsrsCards.cardId, c1.card.cardId));

    const c2 = await saveCard(db, {
      learnerId: learner1,
      cardType: "VOCABULARY",
      targetItem: "earliest-due",
      nativeTranslation: "meaning 2",
    });
    await db
      .update(fsrsCards)
      .set({ due: new Date("2026-01-01T11:40:00Z") })
      .where(eq(fsrsCards.cardId, c2.card.cardId));

    const c3 = await saveCard(db, {
      learnerId: learner1,
      cardType: "VOCABULARY",
      targetItem: "future-card",
      nativeTranslation: "meaning 3",
    });
    await db
      .update(fsrsCards)
      .set({ due: new Date("2026-01-01T12:10:00Z") })
      .where(eq(fsrsCards.cardId, c3.card.cardId));

    const c4 = await saveCard(db, {
      learnerId: learner2,
      cardType: "VOCABULARY",
      targetItem: "other-learner-card",
      nativeTranslation: "meaning 4",
    });
    await db
      .update(fsrsCards)
      .set({ due: new Date("2026-01-01T11:30:00Z") })
      .where(eq(fsrsCards.cardId, c4.card.cardId));

    const items = await dueCardItems(db, learner1, now, 10);
    expect(items).toEqual(["earliest-due", "earlier-due"]);

    const limited = await dueCardItems(db, learner1, now, 1);
    expect(limited).toEqual(["earliest-due"]);

    const zero = await dueCardItems(db, learner1, now, 0);
    expect(zero).toEqual([]);

    const learner2Items = await dueCardItems(db, learner2, now, 5);
    expect(learner2Items).toEqual(["other-learner-card"]);
  });
});

describe("getCard", () => {
  it("returns the card when owned by the learner, or null if owned by another or missing", async () => {
    const learner1 = await newLearner();
    const learner2 = await newLearner();

    const { card } = await saveCard(db, {
      learnerId: learner1,
      cardType: "VOCABULARY",
      targetItem: "item",
      nativeTranslation: "meaning",
    });

    const found = await getCard(db, { learnerId: learner1, cardId: card.cardId });
    expect(found?.cardId).toBe(card.cardId);

    const otherLearner = await getCard(db, { learnerId: learner2, cardId: card.cardId });
    expect(otherLearner).toBeNull();

    const nonExistent = await getCard(db, {
      learnerId: learner1,
      cardId: "00000000-0000-0000-0000-000000000000",
    });
    expect(nonExistent).toBeNull();
  });
});

describe("recordReview", () => {
  it("updates the schedule and writes one log with answerMode, latency and sentence, and throws for another learner's card", async () => {
    const learner1 = await newLearner();
    const learner2 = await newLearner();

    const { card } = await saveCard(db, {
      learnerId: learner1,
      cardType: "VOCABULARY",
      targetItem: "test-card",
      nativeTranslation: "meaning",
    });

    const nextDue = new Date("2026-01-02T10:00:00Z");
    const reviewTime = new Date("2026-01-01T10:00:00Z");
    const updatedSchedule: CardSchedule = {
      state: "Review",
      due: nextDue,
      stability: 2.5,
      difficulty: 4.8,
      elapsedDays: 1,
      scheduledDays: 2,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      lastReview: reviewTime,
    };

    await recordReview(db, {
      learnerId: learner1,
      cardId: card.cardId,
      schedule: updatedSchedule,
      log: {
        rating: 3,
        stateBefore: "New",
        stabilityBefore: 0,
        difficultyBefore: 0,
        elapsedDays: 0,
        scheduledDays: 1,
        answerMode: "typed",
        responseLatencyMs: 2500,
        generatedReviewSentence: "She _____ every day.",
      },
    });

    const updated = await getCard(db, { learnerId: learner1, cardId: card.cardId });
    expect(updated).toMatchObject({
      state: "Review",
      stability: 2.5,
      difficulty: 4.8,
      elapsedDays: 1,
      scheduledDays: 2,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
    });
    expect(updated?.due.toISOString()).toBe(nextDue.toISOString());
    expect(updated?.lastReview?.toISOString()).toBe(reviewTime.toISOString());

    const logs = await db
      .select()
      .from(fsrsReviewLogs)
      .where(eq(fsrsReviewLogs.cardId, card.cardId));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      cardId: card.cardId,
      learnerId: learner1,
      rating: 3,
      stateBefore: "New",
      stabilityBefore: 0,
      difficultyBefore: 0,
      elapsedDays: 0,
      scheduledDays: 1,
      answerMode: "typed",
      responseLatencyMs: 2500,
      generatedReviewSentence: "She _____ every day.",
    });

    await expect(
      recordReview(db, {
        learnerId: learner2,
        cardId: card.cardId,
        schedule: updatedSchedule,
        log: {
          rating: 4,
          stateBefore: "Review",
          stabilityBefore: 2.5,
          difficultyBefore: 4.8,
          elapsedDays: 1,
          scheduledDays: 2,
          answerMode: "spoken",
          responseLatencyMs: 1200,
          generatedReviewSentence: null,
        },
      }),
    ).rejects.toThrow("Card not found.");

    const logsAfter = await db.select().from(fsrsReviewLogs);
    expect(logsAfter).toHaveLength(1);
  });
});

describe("recentLatencies", () => {
  it("filters by mode, rating >= 2 and non-null latency, newest first", async () => {
    const learner1 = await newLearner();
    const learner2 = await newLearner();

    const { card: card1 } = await saveCard(db, {
      learnerId: learner1,
      cardType: "VOCABULARY",
      targetItem: "item1",
      nativeTranslation: "trans1",
    });

    const { card: card2 } = await saveCard(db, {
      learnerId: learner2,
      cardType: "VOCABULARY",
      targetItem: "item2",
      nativeTranslation: "trans2",
    });

    const baseTime = new Date("2026-01-01T12:00:00Z").getTime();

    await db.insert(fsrsReviewLogs).values({
      cardId: card1.cardId,
      learnerId: learner1,
      rating: 3,
      stateBefore: "New",
      stabilityBefore: 0,
      difficultyBefore: 0,
      elapsedDays: 0,
      scheduledDays: 1,
      answerMode: "typed",
      responseLatencyMs: 1000,
      reviewedAt: new Date(baseTime - 30_000),
    });

    await db.insert(fsrsReviewLogs).values({
      cardId: card1.cardId,
      learnerId: learner1,
      rating: 1,
      stateBefore: "New",
      stabilityBefore: 0,
      difficultyBefore: 0,
      elapsedDays: 0,
      scheduledDays: 1,
      answerMode: "typed",
      responseLatencyMs: 5000,
      reviewedAt: new Date(baseTime - 20_000),
    });

    await db.insert(fsrsReviewLogs).values({
      cardId: card1.cardId,
      learnerId: learner1,
      rating: 4,
      stateBefore: "New",
      stabilityBefore: 0,
      difficultyBefore: 0,
      elapsedDays: 0,
      scheduledDays: 1,
      answerMode: "spoken",
      responseLatencyMs: 2000,
      reviewedAt: new Date(baseTime - 15_000),
    });

    await db.insert(fsrsReviewLogs).values({
      cardId: card1.cardId,
      learnerId: learner1,
      rating: 2,
      stateBefore: "New",
      stabilityBefore: 0,
      difficultyBefore: 0,
      elapsedDays: 0,
      scheduledDays: 1,
      answerMode: "typed",
      responseLatencyMs: null,
      reviewedAt: new Date(baseTime - 10_000),
    });

    await db.insert(fsrsReviewLogs).values({
      cardId: card1.cardId,
      learnerId: learner1,
      rating: 4,
      stateBefore: "New",
      stabilityBefore: 0,
      difficultyBefore: 0,
      elapsedDays: 0,
      scheduledDays: 1,
      answerMode: "typed",
      responseLatencyMs: 1500,
      reviewedAt: new Date(baseTime - 5_000),
    });

    await db.insert(fsrsReviewLogs).values({
      cardId: card2.cardId,
      learnerId: learner2,
      rating: 3,
      stateBefore: "New",
      stabilityBefore: 0,
      difficultyBefore: 0,
      elapsedDays: 0,
      scheduledDays: 1,
      answerMode: "typed",
      responseLatencyMs: 9999,
      reviewedAt: new Date(baseTime),
    });

    const typedLatencies = await recentLatencies(db, learner1, "typed");
    expect(typedLatencies).toEqual([1500, 1000]);

    const spokenLatencies = await recentLatencies(db, learner1, "spoken");
    expect(spokenLatencies).toEqual([2000]);

    const limited = await recentLatencies(db, learner1, "typed", 1);
    expect(limited).toEqual([1500]);
  });
});
