import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { learnerErrorPatterns, sessionFeedback, type StoredFeedbackItem } from "@/lib/db/schema";
import {
  activeErrorExamples,
  getFeedback,
  markFeedbackFailed,
  markFeedbackPending,
  recordErrorPatterns,
  saveFeedback,
} from "@/lib/feedback-store";
import { ensureLearnerProfile } from "@/lib/learner";
import { newLearnerId } from "@/lib/learner-id";
import { startSession } from "@/lib/sessions";
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

async function createSession(learnerId: string) {
  const session = await startSession(db, {
    learnerId,
    mode: "conversation",
    scenarioId: "cafe",
  });
  return session.sessionId;
}

describe("markFeedbackPending", () => {
  it("creates a pending row, and a second call keeps one row", async () => {
    const learnerId = await newLearner();
    const sessionId = await createSession(learnerId);

    await markFeedbackPending(db, { learnerId, sessionId });

    const first = await getFeedback(db, { learnerId, sessionId });
    expect(first).toMatchObject({
      sessionId,
      learnerId,
      status: "pending",
      items: [],
      vocabulary: [],
    });

    await markFeedbackPending(db, { learnerId, sessionId });

    const rows = await db
      .select()
      .from(sessionFeedback)
      .where(eq(sessionFeedback.sessionId, sessionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
  });
});

describe("saveFeedback", () => {
  it("sets done with the items and vocabulary", async () => {
    const learnerId = await newLearner();
    const sessionId = await createSession(learnerId);

    await markFeedbackPending(db, { learnerId, sessionId });

    const items: StoredFeedbackItem[] = [
      {
        line: 1,
        turnId: crypto.randomUUID(),
        original: "I go home yesterday",
        inputMode: "voice",
        edits: [{ original: "go", correction: "went", code: "R:VERB:TENSE" }],
        minimalCorrection: "I went home yesterday",
        fluencyUpgrade: null,
        l1Cause: null,
        explanation: "Use past tense for completed actions.",
      },
    ];
    const vocabulary = [{ item: "yesterday", meaning: "গতকাল", example: "I went home yesterday." }];

    await saveFeedback(db, { learnerId, sessionId, items, vocabulary });

    const saved = await getFeedback(db, { learnerId, sessionId });
    expect(saved).toMatchObject({
      sessionId,
      learnerId,
      status: "done",
      items,
      vocabulary,
    });
  });
});

describe("markFeedbackFailed", () => {
  it("sets failed", async () => {
    const learnerId = await newLearner();
    const sessionId = await createSession(learnerId);

    await markFeedbackPending(db, { learnerId, sessionId });
    await markFeedbackFailed(db, { learnerId, sessionId });

    const failed = await getFeedback(db, { learnerId, sessionId });
    expect(failed?.status).toBe("failed");
  });
});

describe("getFeedback", () => {
  it("returns the row for its learner and null for another learner", async () => {
    const ownerId = await newLearner();
    const otherId = await newLearner();
    const sessionId = await createSession(ownerId);

    await markFeedbackPending(db, { learnerId: ownerId, sessionId });

    const ownerFeedback = await getFeedback(db, { learnerId: ownerId, sessionId });
    expect(ownerFeedback).toMatchObject({ sessionId, learnerId: ownerId });

    const otherFeedback = await getFeedback(db, { learnerId: otherId, sessionId });
    expect(otherFeedback).toBeNull();
  });
});

describe("recordErrorPatterns", () => {
  it("records and updates error patterns across sessions", async () => {
    const learnerId = await newLearner();

    // First session: voice item with two R:VERB:TENSE edits and typed item with one M:DET edit.
    const voiceItem: StoredFeedbackItem = {
      line: 1,
      turnId: crypto.randomUUID(),
      original: "I go to school and eat apple",
      inputMode: "voice",
      edits: [
        { original: "go", correction: "went", code: "R:VERB:TENSE" },
        { original: "eat", correction: "ate", code: "R:VERB:TENSE" },
      ],
      minimalCorrection: "I went to school and ate apple",
      fluencyUpgrade: null,
      l1Cause: null,
      explanation: "Use past tense for past actions.",
    };

    const typedItem: StoredFeedbackItem = {
      line: 2,
      turnId: crypto.randomUUID(),
      original: "He is teacher",
      inputMode: "typed",
      edits: [{ original: "teacher", correction: "a teacher", code: "M:DET" }],
      minimalCorrection: "He is a teacher",
      fluencyUpgrade: null,
      l1Cause: null,
      explanation: "Add 'a' before singular countable nouns.",
    };

    await recordErrorPatterns(db, {
      learnerId,
      items: [voiceItem, typedItem],
      modalities: ["SPEAKING_GRAMMAR", "WRITING_GRAMMAR"],
    });

    const patternsAfterFirst = await db
      .select()
      .from(learnerErrorPatterns)
      .where(eq(learnerErrorPatterns.learnerId, learnerId));

    expect(patternsAfterFirst).toHaveLength(2);

    const speakingTense = patternsAfterFirst.find(
      (p) => p.modality === "SPEAKING_GRAMMAR" && p.errorCode === "R:VERB:TENSE",
    );
    expect(speakingTense).toMatchObject({
      occurrenceCount: 2,
      resolvedStreak: 0,
      description: "Use past tense for past actions.",
      lastExampleLearnerInput: "I go to school and eat apple",
      lastExampleMinimalCorrection: "I went to school and ate apple",
    });

    const writingDet = patternsAfterFirst.find(
      (p) => p.modality === "WRITING_GRAMMAR" && p.errorCode === "M:DET",
    );
    expect(writingDet).toMatchObject({
      occurrenceCount: 1,
      resolvedStreak: 0,
      description: "Add 'a' before singular countable nouns.",
      lastExampleLearnerInput: "He is teacher",
      lastExampleMinimalCorrection: "He is a teacher",
    });

    // Seed a SPEAKING_GRAMMAR/M:DET pattern earlier before second session.
    await db.insert(learnerErrorPatterns).values({
      learnerId,
      modality: "SPEAKING_GRAMMAR",
      errorCode: "M:DET",
      description: "Missing determiner in speech",
      occurrenceCount: 1,
      resolvedStreak: 0,
      lastExampleLearnerInput: "I saw dog",
      lastExampleMinimalCorrection: "I saw a dog",
    });

    // Second session: R:VERB:TENSE again with modalities ["SPEAKING_GRAMMAR"].
    const secondVoiceItem: StoredFeedbackItem = {
      line: 1,
      turnId: crypto.randomUUID(),
      original: "I buy book yesterday",
      inputMode: "voice",
      edits: [{ original: "buy", correction: "bought", code: "R:VERB:TENSE" }],
      minimalCorrection: "I bought book yesterday",
      fluencyUpgrade: null,
      l1Cause: null,
      explanation: "Buy becomes bought in the past.",
    };

    await recordErrorPatterns(db, {
      learnerId,
      items: [secondVoiceItem],
      modalities: ["SPEAKING_GRAMMAR"],
    });

    const patternsAfterSecond = await db
      .select()
      .from(learnerErrorPatterns)
      .where(eq(learnerErrorPatterns.learnerId, learnerId));

    const speakingTenseAfterSecond = patternsAfterSecond.find(
      (p) => p.modality === "SPEAKING_GRAMMAR" && p.errorCode === "R:VERB:TENSE",
    );
    // its count becomes 3 and its streak stays 0.
    expect(speakingTenseAfterSecond).toMatchObject({
      occurrenceCount: 3,
      resolvedStreak: 0,
      description: "Buy becomes bought in the past.",
      lastExampleLearnerInput: "I buy book yesterday",
      lastExampleMinimalCorrection: "I bought book yesterday",
    });

    // A SPEAKING_GRAMMAR/M:DET pattern seeded earlier gets streak 1.
    const speakingDetAfterSecond = patternsAfterSecond.find(
      (p) => p.modality === "SPEAKING_GRAMMAR" && p.errorCode === "M:DET",
    );
    expect(speakingDetAfterSecond).toMatchObject({
      occurrenceCount: 1,
      resolvedStreak: 1,
    });

    // WRITING_GRAMMAR/M:DET is untouched, because writing was not used.
    const writingDetAfterSecond = patternsAfterSecond.find(
      (p) => p.modality === "WRITING_GRAMMAR" && p.errorCode === "M:DET",
    );
    expect(writingDetAfterSecond).toMatchObject({
      occurrenceCount: 1,
      resolvedStreak: 0,
    });

    // Empty items with modalities ["WRITING_GRAMMAR"]: every writing pattern's streak goes up by 1.
    await recordErrorPatterns(db, {
      learnerId,
      items: [],
      modalities: ["WRITING_GRAMMAR"],
    });

    const patternsAfterThird = await db
      .select()
      .from(learnerErrorPatterns)
      .where(eq(learnerErrorPatterns.learnerId, learnerId));

    const writingDetAfterThird = patternsAfterThird.find(
      (p) => p.modality === "WRITING_GRAMMAR" && p.errorCode === "M:DET",
    );
    expect(writingDetAfterThird).toMatchObject({
      occurrenceCount: 1,
      resolvedStreak: 1,
    });

    // Speaking patterns are untouched because speaking was not used.
    const speakingTenseAfterThird = patternsAfterThird.find(
      (p) => p.modality === "SPEAKING_GRAMMAR" && p.errorCode === "R:VERB:TENSE",
    );
    expect(speakingTenseAfterThird?.resolvedStreak).toBe(0);

    const speakingDetAfterThird = patternsAfterThird.find(
      (p) => p.modality === "SPEAKING_GRAMMAR" && p.errorCode === "M:DET",
    );
    expect(speakingDetAfterThird?.resolvedStreak).toBe(1);
  });
});

describe("activeErrorExamples", () => {
  it("skips resolved patterns and patterns without examples, orders by count then recency, and respects limit", async () => {
    const learner1 = await newLearner();
    const learner2 = await newLearner();

    const t1 = new Date("2026-01-01T10:00:00Z");
    const t2 = new Date("2026-01-01T11:00:00Z");
    const t3 = new Date("2026-01-01T12:00:00Z");

    await db.insert(learnerErrorPatterns).values({
      learnerId: learner1,
      modality: "SPEAKING_GRAMMAR",
      errorCode: "R:VERB:TENSE",
      description: "Past tense",
      occurrenceCount: 5,
      resolvedStreak: 0,
      lastExampleLearnerInput: "I go yesterday",
      lastExampleMinimalCorrection: "I went yesterday",
      lastSeenAt: t1,
    });

    await db.insert(learnerErrorPatterns).values({
      learnerId: learner1,
      modality: "SPEAKING_GRAMMAR",
      errorCode: "M:DET",
      description: "Missing article",
      occurrenceCount: 10,
      resolvedStreak: 2,
      lastExampleLearnerInput: "I saw cat",
      lastExampleMinimalCorrection: "I saw a cat",
      lastSeenAt: t2,
    });

    await db.insert(learnerErrorPatterns).values({
      learnerId: learner1,
      modality: "WRITING_GRAMMAR",
      errorCode: "WO:ADV",
      description: "Adverb order",
      occurrenceCount: 5,
      resolvedStreak: 1,
      lastExampleLearnerInput: "I slowly walked",
      lastExampleMinimalCorrection: "I walked slowly",
      lastSeenAt: t3,
    });

    await db.insert(learnerErrorPatterns).values({
      learnerId: learner1,
      modality: "SPEAKING_GRAMMAR",
      errorCode: "RESOLVED:1",
      description: "Resolved pattern",
      occurrenceCount: 20,
      resolvedStreak: 3,
      lastExampleLearnerInput: "bad input",
      lastExampleMinimalCorrection: "good input",
      lastSeenAt: t3,
    });

    await db.insert(learnerErrorPatterns).values({
      learnerId: learner1,
      modality: "SPEAKING_GRAMMAR",
      errorCode: "RESOLVED:2",
      description: "Resolved pattern",
      occurrenceCount: 20,
      resolvedStreak: 4,
      lastExampleLearnerInput: "bad input",
      lastExampleMinimalCorrection: "good input",
      lastSeenAt: t3,
    });

    await db.insert(learnerErrorPatterns).values({
      learnerId: learner1,
      modality: "SPEAKING_GRAMMAR",
      errorCode: "NO:INPUT",
      description: "No input example",
      occurrenceCount: 15,
      resolvedStreak: 0,
      lastExampleLearnerInput: null,
      lastExampleMinimalCorrection: "good input",
      lastSeenAt: t3,
    });

    await db.insert(learnerErrorPatterns).values({
      learnerId: learner1,
      modality: "SPEAKING_GRAMMAR",
      errorCode: "NO:CORRECTION",
      description: "No correction example",
      occurrenceCount: 15,
      resolvedStreak: 0,
      lastExampleLearnerInput: "bad input",
      lastExampleMinimalCorrection: null,
      lastSeenAt: t3,
    });

    await db.insert(learnerErrorPatterns).values({
      learnerId: learner2,
      modality: "SPEAKING_GRAMMAR",
      errorCode: "OTHER:LEARNER",
      description: "Other learner pattern",
      occurrenceCount: 50,
      resolvedStreak: 0,
      lastExampleLearnerInput: "other bad",
      lastExampleMinimalCorrection: "other good",
      lastSeenAt: t3,
    });

    const all = await activeErrorExamples(db, learner1, 10);
    expect(all).toEqual([
      { said: "I saw cat", correct: "I saw a cat" },
      { said: "I slowly walked", correct: "I walked slowly" },
      { said: "I go yesterday", correct: "I went yesterday" },
    ]);

    const limited = await activeErrorExamples(db, learner1, 2);
    expect(limited).toEqual([
      { said: "I saw cat", correct: "I saw a cat" },
      { said: "I slowly walked", correct: "I walked slowly" },
    ]);

    const zero = await activeErrorExamples(db, learner1, 0);
    expect(zero).toEqual([]);

    const learner2Patterns = await activeErrorExamples(db, learner2, 10);
    expect(learner2Patterns).toEqual([{ said: "other bad", correct: "other good" }]);
  });
});
