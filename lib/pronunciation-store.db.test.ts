import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { pronunciationScores, sessions } from "@/lib/db/schema";
import { ensureLearnerProfile } from "@/lib/learner";
import { newLearnerId } from "@/lib/learner-id";
import { savePronunciationScore } from "@/lib/pronunciation-store";
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
