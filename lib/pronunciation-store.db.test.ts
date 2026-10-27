import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  learnerErrorPatterns,
  pronunciationScores,
  sessionFeedback,
  sessions,
} from "@/lib/db/schema";
import { activeErrorExamples, markFeedbackPending } from "@/lib/feedback-store";
import { ensureLearnerProfile } from "@/lib/learner";
import { newLearnerId } from "@/lib/learner-id";
import {
  clearPronunciationStatus,
  countSessionScores,
  loadSessionScores,
  markPronunciationPending,
  recordPronunciationPatterns,
  savePronunciationScore,
  savePronunciationTips,
} from "@/lib/pronunciation-store";
import { saveExchange, startSession } from "@/lib/sessions";
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

describe("savePronunciationScore", () => {
  it("saves a score for a real user turn and reads it back", async () => {
    const learnerId = await newLearner();
    const sessionId = await createSession(learnerId);
    const userTurnId = crypto.randomUUID();

    await saveExchange(db, {
      sessionId,
      userText: "I visited the zoo.",
      inputMode: "voice",
      replyText: "That sounds fun!",
      replyTurnId: crypto.randomUUID(),
      userTurnId,
      firstTokenMs: 200,
    });

    const scoreData = {
      turnId: userTurnId,
      sessionId,
      learnerId,
      audioMs: 2500,
      accuracy: 82.5,
      fluency: 78.0,
      prosody: 85.0,
      completeness: 90.0,
      pronScore: 83.2,
      weakWords: [
        {
          word: "zoo",
          score: 55,
          errorType: "Mispronunciation",
        },
      ],
      mismatches: [
        {
          word: "zoo",
          expected: "z",
          heard: "dʒ",
          score: 55,
        },
      ],
    };

    await savePronunciationScore(db, scoreData);

    const [saved] = await db
      .select()
      .from(pronunciationScores)
      .where(eq(pronunciationScores.turnId, userTurnId));

    expect(saved).toBeDefined();
    expect(saved).toMatchObject({
      turnId: userTurnId,
      sessionId,
      learnerId,
      audioMs: 2500,
      accuracy: 82.5,
      fluency: 78.0,
      prosody: 85.0,
      completeness: 90.0,
      pronScore: 83.2,
      weakWords: [
        {
          word: "zoo",
          score: 55,
          errorType: "Mispronunciation",
        },
      ],
      mismatches: [
        {
          word: "zoo",
          expected: "z",
          heard: "dʒ",
          score: 55,
        },
      ],
    });
  });

  it("deleting the session removes the row via cascade", async () => {
    const learnerId = await newLearner();
    const sessionId = await createSession(learnerId);
    const userTurnId = crypto.randomUUID();

    await saveExchange(db, {
      sessionId,
      userText: "Hello there.",
      inputMode: "voice",
      replyText: "Hi!",
      replyTurnId: crypto.randomUUID(),
      userTurnId,
      firstTokenMs: 150,
    });

    await savePronunciationScore(db, {
      turnId: userTurnId,
      sessionId,
      learnerId,
      audioMs: 1500,
      accuracy: 90.0,
      fluency: 85.0,
      prosody: 88.0,
      completeness: 95.0,
      pronScore: 89.5,
      weakWords: [],
      mismatches: [],
    });

    await db.delete(sessions).where(eq(sessions.sessionId, sessionId));

    const rows = await db
      .select()
      .from(pronunciationScores)
      .where(eq(pronunciationScores.turnId, userTurnId));

    expect(rows).toHaveLength(0);
  });
});

describe("countSessionScores and loadSessionScores", () => {
  it("joins transcripts in position order and excludes other learners or sessions", async () => {
    const learner1 = await newLearner();
    const learner2 = await newLearner();
    const session1 = await createSession(learner1);
    const session2 = await createSession(learner1);
    const session3 = await createSession(learner2);

    const turn1Id = crypto.randomUUID();
    const turn2Id = crypto.randomUUID();
    const otherSessionTurnId = crypto.randomUUID();
    const otherLearnerTurnId = crypto.randomUUID();

    // Turn 1 for session 1 (position 0)
    await saveExchange(db, {
      sessionId: session1,
      userText: "Turn one text.",
      inputMode: "voice",
      replyText: "Reply one",
      replyTurnId: crypto.randomUUID(),
      userTurnId: turn1Id,
      firstTokenMs: 100,
    });

    // Turn 2 for session 1 (position 2)
    await saveExchange(db, {
      sessionId: session1,
      userText: "Turn two text.",
      inputMode: "voice",
      replyText: "Reply two",
      replyTurnId: crypto.randomUUID(),
      userTurnId: turn2Id,
      firstTokenMs: 100,
    });

    // Score for turn 1
    await savePronunciationScore(db, {
      turnId: turn1Id,
      sessionId: session1,
      learnerId: learner1,
      audioMs: 1200,
      accuracy: 80,
      fluency: 75,
      prosody: 70,
      completeness: 85,
      pronScore: 78,
      weakWords: [],
      mismatches: [],
    });

    // Score for turn 2
    await savePronunciationScore(db, {
      turnId: turn2Id,
      sessionId: session1,
      learnerId: learner1,
      audioMs: 2000,
      accuracy: 90,
      fluency: 85,
      prosody: 88,
      completeness: 92,
      pronScore: 89,
      weakWords: [],
      mismatches: [],
    });

    // Turn & score for session 2 (same learner, different session)
    await saveExchange(db, {
      sessionId: session2,
      userText: "Other session text.",
      inputMode: "voice",
      replyText: "Reply other",
      replyTurnId: crypto.randomUUID(),
      userTurnId: otherSessionTurnId,
      firstTokenMs: 100,
    });
    await savePronunciationScore(db, {
      turnId: otherSessionTurnId,
      sessionId: session2,
      learnerId: learner1,
      audioMs: 1000,
      accuracy: 50,
      fluency: 50,
      prosody: 50,
      completeness: 50,
      pronScore: 50,
      weakWords: [],
      mismatches: [],
    });

    // Turn & score for session 3 (different learner)
    await saveExchange(db, {
      sessionId: session3,
      userText: "Other learner text.",
      inputMode: "voice",
      replyText: "Reply learner",
      replyTurnId: crypto.randomUUID(),
      userTurnId: otherLearnerTurnId,
      firstTokenMs: 100,
    });
    await savePronunciationScore(db, {
      turnId: otherLearnerTurnId,
      sessionId: session3,
      learnerId: learner2,
      audioMs: 1500,
      accuracy: 60,
      fluency: 60,
      prosody: 60,
      completeness: 60,
      pronScore: 60,
      weakWords: [],
      mismatches: [],
    });

    // countSessionScores
    const count1 = await countSessionScores(db, session1);
    expect(count1).toBe(2);

    const count2 = await countSessionScores(db, session2);
    expect(count2).toBe(1);

    // loadSessionScores for session 1
    const loaded = await loadSessionScores(db, { learnerId: learner1, sessionId: session1 });
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.transcript).toBe("Turn one text.");
    expect(loaded[0]?.audioMs).toBe(1200);
    expect(loaded[0]?.accuracy).toBe(80);
    expect(loaded[1]?.transcript).toBe("Turn two text.");
    expect(loaded[1]?.audioMs).toBe(2000);
    expect(loaded[1]?.accuracy).toBe(90);

    // loadSessionScores with wrong learner returns empty
    const loadedWrongLearner = await loadSessionScores(db, {
      learnerId: learner2,
      sessionId: session1,
    });
    expect(loadedWrongLearner).toHaveLength(0);
  });
});

describe("pronunciation feedback status", () => {
  it("transitions pending -> tips saved (done) -> clear (null)", async () => {
    const learnerId = await newLearner();
    const sessionId = await createSession(learnerId);

    // markFeedbackPending creates the session_feedback row with pronunciationStatus: null
    await markFeedbackPending(db, { learnerId, sessionId });

    let [fb] = await db
      .select()
      .from(sessionFeedback)
      .where(eq(sessionFeedback.sessionId, sessionId));
    expect(fb?.pronunciationStatus).toBeNull();

    // markPronunciationPending
    await markPronunciationPending(db, { learnerId, sessionId });
    [fb] = await db.select().from(sessionFeedback).where(eq(sessionFeedback.sessionId, sessionId));
    expect(fb?.pronunciationStatus).toBe("pending");

    // savePronunciationTips
    const tips = [{ focus: "IPA:/v/_to_[b]", tip: "Touch top teeth to bottom lip." }];
    await savePronunciationTips(db, { learnerId, sessionId, tips });
    [fb] = await db.select().from(sessionFeedback).where(eq(sessionFeedback.sessionId, sessionId));
    expect(fb?.pronunciationStatus).toBe("done");
    expect(fb?.pronunciationTips).toEqual(tips);

    // clearPronunciationStatus
    await clearPronunciationStatus(db, { learnerId, sessionId });
    [fb] = await db.select().from(sessionFeedback).where(eq(sessionFeedback.sessionId, sessionId));
    expect(fb?.pronunciationStatus).toBeNull();
  });
});

describe("recordPronunciationPatterns", () => {
  it("inserts count, updates count and resets streak on second call, increments streak for missing codes, and never returns from activeErrorExamples", async () => {
    const learnerId = await newLearner();

    // Call 1: inserts IPA:/v/_to_[b] with count 2
    await recordPronunciationPatterns(db, {
      learnerId,
      patterns: [
        {
          code: "IPA:/v/_to_[b]",
          count: 2,
          words: ["very", "seven"],
          meanScore: 45,
        },
      ],
    });

    let [patternRow] = await db
      .select()
      .from(learnerErrorPatterns)
      .where(
        and(
          eq(learnerErrorPatterns.learnerId, learnerId),
          eq(learnerErrorPatterns.errorCode, "IPA:/v/_to_[b]"),
        ),
      );
    expect(patternRow).toBeDefined();
    expect(patternRow?.occurrenceCount).toBe(2);
    expect(patternRow?.resolvedStreak).toBe(0);
    expect(patternRow?.lastExampleLearnerInput).toBe("very");
    expect(patternRow?.lastExampleMinimalCorrection).toBeNull();
    expect(Number(patternRow?.meanAcousticAccuracy)).toBe(45);

    // Call 2: only IPA:/w/_to_[v] is present. IPA:/v/_to_[b] is missing -> streak should increment to 1
    await recordPronunciationPatterns(db, {
      learnerId,
      patterns: [
        {
          code: "IPA:/w/_to_[v]",
          count: 1,
          words: ["west"],
          meanScore: 40,
        },
      ],
    });

    [patternRow] = await db
      .select()
      .from(learnerErrorPatterns)
      .where(
        and(
          eq(learnerErrorPatterns.learnerId, learnerId),
          eq(learnerErrorPatterns.errorCode, "IPA:/v/_to_[b]"),
        ),
      );
    expect(patternRow?.resolvedStreak).toBe(1);
    expect(patternRow?.occurrenceCount).toBe(2);

    const [wPatternRow] = await db
      .select()
      .from(learnerErrorPatterns)
      .where(
        and(
          eq(learnerErrorPatterns.learnerId, learnerId),
          eq(learnerErrorPatterns.errorCode, "IPA:/w/_to_[v]"),
        ),
      );
    expect(wPatternRow?.resolvedStreak).toBe(0);
    expect(wPatternRow?.occurrenceCount).toBe(1);

    // Call 3: IPA:/v/_to_[b] occurs again with count 3. Should add to occurrenceCount (2 + 3 = 5) and reset streak to 0
    await recordPronunciationPatterns(db, {
      learnerId,
      patterns: [
        {
          code: "IPA:/v/_to_[b]",
          count: 3,
          words: ["video"],
          meanScore: 50,
        },
      ],
    });

    [patternRow] = await db
      .select()
      .from(learnerErrorPatterns)
      .where(
        and(
          eq(learnerErrorPatterns.learnerId, learnerId),
          eq(learnerErrorPatterns.errorCode, "IPA:/v/_to_[b]"),
        ),
      );
    expect(patternRow?.occurrenceCount).toBe(5);
    expect(patternRow?.resolvedStreak).toBe(0);
    expect(patternRow?.lastExampleLearnerInput).toBe("video");
    expect(Number(patternRow?.meanAcousticAccuracy)).toBe(50);

    // activeErrorExamples should NOT return any of these rows because lastExampleMinimalCorrection is null
    const examples = await activeErrorExamples(db, learnerId, 5);
    expect(examples).toHaveLength(0);
  });
});
