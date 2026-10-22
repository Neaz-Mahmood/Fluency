import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { saveCard, savedTargetItems } from "@/lib/cards";
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
