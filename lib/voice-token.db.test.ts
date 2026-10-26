import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ensureLearnerProfile, setVoiceConsent } from "@/lib/learner";
import { newLearnerId } from "@/lib/learner-id";
import { endSession, startSession } from "@/lib/sessions";
import { recordVoiceSeconds } from "@/lib/voice-quota";
import { checkVoiceAccess } from "@/lib/voice-token";
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
  return ensureLearnerProfile(db, newLearnerId());
}

describe("checkVoiceAccess", () => {
  const now = new Date("2026-10-26T12:00:00Z");

  it("refuses with consent when consent was not given, even with quota left", async () => {
    const learner = await newLearner();
    const access = await checkVoiceAccess(
      db,
      learner,
      { scenarioId: "cafe", sessionId: null },
      now,
    );
    expect(access).toEqual({ refusal: "consent" });
  });

  it("returns 300 seconds remaining when consented with no usage", async () => {
    let learner = await newLearner();
    await setVoiceConsent(db, learner.learnerId, true);
    learner = await ensureLearnerProfile(db, learner.learnerId);

    const access = await checkVoiceAccess(
      db,
      learner,
      { scenarioId: "cafe", sessionId: null },
      now,
    );
    expect(access).toEqual({ remainingSeconds: 300 });
  });

  it("refuses with quota when 300 seconds used today", async () => {
    let learner = await newLearner();
    await setVoiceConsent(db, learner.learnerId, true);
    learner = await ensureLearnerProfile(db, learner.learnerId);

    await recordVoiceSeconds(db, learner.learnerId, 300, now);

    const access = await checkVoiceAccess(
      db,
      learner,
      { scenarioId: "cafe", sessionId: null },
      now,
    );
    expect(access).toEqual({ refusal: "quota" });
  });

  it("returns 180 seconds remaining when 120 seconds used", async () => {
    let learner = await newLearner();
    await setVoiceConsent(db, learner.learnerId, true);
    learner = await ensureLearnerProfile(db, learner.learnerId);

    await recordVoiceSeconds(db, learner.learnerId, 120, now);

    const access = await checkVoiceAccess(
      db,
      learner,
      { scenarioId: "cafe", sessionId: null },
      now,
    );
    expect(access).toEqual({ remainingSeconds: 180 });
  });

  it("succeeds with the learner's own open café session", async () => {
    let learner = await newLearner();
    await setVoiceConsent(db, learner.learnerId, true);
    learner = await ensureLearnerProfile(db, learner.learnerId);

    const session = await startSession(db, {
      learnerId: learner.learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });

    const access = await checkVoiceAccess(
      db,
      learner,
      { scenarioId: "cafe", sessionId: session.sessionId },
      now,
    );
    expect(access).toEqual({ remainingSeconds: 300 });
  });

  it("refuses with session for another learner's session", async () => {
    let learner1 = await newLearner();
    await setVoiceConsent(db, learner1.learnerId, true);
    learner1 = await ensureLearnerProfile(db, learner1.learnerId);

    const learner2 = await newLearner();
    const otherSession = await startSession(db, {
      learnerId: learner2.learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });

    const access = await checkVoiceAccess(
      db,
      learner1,
      { scenarioId: "cafe", sessionId: otherSession.sessionId },
      now,
    );
    expect(access).toEqual({ refusal: "session" });
  });

  it("refuses with session for an ended session", async () => {
    let learner = await newLearner();
    await setVoiceConsent(db, learner.learnerId, true);
    learner = await ensureLearnerProfile(db, learner.learnerId);

    const session = await startSession(db, {
      learnerId: learner.learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });
    await endSession(db, { learnerId: learner.learnerId, sessionId: session.sessionId });

    const access = await checkVoiceAccess(
      db,
      learner,
      { scenarioId: "cafe", sessionId: session.sessionId },
      now,
    );
    expect(access).toEqual({ refusal: "session" });
  });

  it("refuses with session for a session of a different scenario", async () => {
    let learner = await newLearner();
    await setVoiceConsent(db, learner.learnerId, true);
    learner = await ensureLearnerProfile(db, learner.learnerId);

    const session = await startSession(db, {
      learnerId: learner.learnerId,
      mode: "conversation",
      scenarioId: "neighbor",
    });

    const access = await checkVoiceAccess(
      db,
      learner,
      { scenarioId: "cafe", sessionId: session.sessionId },
      now,
    );
    expect(access).toEqual({ refusal: "session" });
  });
});
