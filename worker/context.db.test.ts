import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { learnerProfiles } from "@/lib/db/schema";
import { setVoiceConsent } from "@/lib/learner";
import { endSession, saveExchange, startSession } from "@/lib/sessions";
import { recordVoiceSeconds } from "@/lib/voice-quota";
import { createTestDb, resetTestDb } from "@/test/db";
import { TEST_DATABASE_URL } from "@/test/db-url";
import { loadVoiceContext } from "./context";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const db = createTestDb();

beforeEach(async () => {
  await resetTestDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function insertProfile() {
  const learnerId = crypto.randomUUID();
  const [profile] = await db
    .insert(learnerProfiles)
    .values({
      learnerId,
      nativeLanguage: "bn-BD",
      targetLanguage: "en-US",
      cefrSpeaking: "A2",
    })
    .returning();
  return profile;
}

describe("worker context database tests", () => {
  it("returns error for an unknown learner", async () => {
    const unknownId = crypto.randomUUID();
    const res = await loadVoiceContext(
      db,
      { learnerId: unknownId, scenarioId: "cafe", sessionId: null },
      new Date(),
    );
    expect(res).toEqual({ error: "Learner not found." });
  });

  it("loads context for a new learner with no session", async () => {
    const profile = await insertProfile();
    await setVoiceConsent(db, profile.learnerId, true);
    const res = await loadVoiceContext(
      db,
      { learnerId: profile.learnerId, scenarioId: "cafe", sessionId: null },
      new Date(),
    );

    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.sessionId).toBeNull();
      expect(res.history).toEqual([]);
      expect(res.instructions).toContain("café barista");
      expect(res.remainingSeconds).toBe(300);
      expect(res.ttsSpeed).toBe(0.9);
    }
  });

  it("uses listening level over speaking level for ttsSpeed", async () => {
    const learnerId = crypto.randomUUID();
    const [profile] = await db
      .insert(learnerProfiles)
      .values({
        learnerId,
        nativeLanguage: "bn-BD",
        targetLanguage: "en-US",
        cefrSpeaking: "B1",
        cefrListening: "A1",
      })
      .returning();
    await setVoiceConsent(db, profile.learnerId, true);
    const res = await loadVoiceContext(
      db,
      { learnerId: profile.learnerId, scenarioId: "cafe", sessionId: null },
      new Date(),
    );

    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.ttsSpeed).toBe(0.8);
    }
  });

  it("loads context for an open session with 2 saved turns in order", async () => {
    const profile = await insertProfile();
    await setVoiceConsent(db, profile.learnerId, true);
    const session = await startSession(db, {
      learnerId: profile.learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });

    await saveExchange(db, {
      sessionId: session.sessionId,
      userText: "One coffee please.",
      inputMode: "voice",
      replyText: "Sure, would you like milk?",
      replyTurnId: crypto.randomUUID(),
      firstTokenMs: 400,
    });

    const res = await loadVoiceContext(
      db,
      { learnerId: profile.learnerId, scenarioId: "cafe", sessionId: session.sessionId },
      new Date(),
    );

    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.sessionId).toBe(session.sessionId);
      expect(res.history).toEqual([
        { role: "user", content: "One coffee please." },
        { role: "assistant", content: "Sure, would you like milk?" },
      ]);
      expect(res.remainingSeconds).toBe(300);
    }
  });

  it("returns 'Session not found.' if sessionId belongs to another learner", async () => {
    const learner1 = await insertProfile();
    const learner2 = await insertProfile();
    await setVoiceConsent(db, learner1.learnerId, true);
    await setVoiceConsent(db, learner2.learnerId, true);
    const session1 = await startSession(db, {
      learnerId: learner1.learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });

    const res = await loadVoiceContext(
      db,
      { learnerId: learner2.learnerId, scenarioId: "cafe", sessionId: session1.sessionId },
      new Date(),
    );
    expect(res).toEqual({ error: "Session not found." });
  });

  it("returns 'Session not found.' for an ended session", async () => {
    const profile = await insertProfile();
    await setVoiceConsent(db, profile.learnerId, true);
    const session = await startSession(db, {
      learnerId: profile.learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });
    await endSession(db, { learnerId: profile.learnerId, sessionId: session.sessionId });

    const res = await loadVoiceContext(
      db,
      { learnerId: profile.learnerId, scenarioId: "cafe", sessionId: session.sessionId },
      new Date(),
    );
    expect(res).toEqual({ error: "Session not found." });
  });

  it("returns error for a learner without consent", async () => {
    const profile = await insertProfile();
    const res = await loadVoiceContext(
      db,
      { learnerId: profile.learnerId, scenarioId: "cafe", sessionId: null },
      new Date(),
    );
    expect(res).toEqual({ error: "No voice consent." });
  });

  it("returns error for a consented learner with 300 s recorded today", async () => {
    const profile = await insertProfile();
    await setVoiceConsent(db, profile.learnerId, true);
    const now = new Date();
    await recordVoiceSeconds(db, profile.learnerId, 300, now);

    const res = await loadVoiceContext(
      db,
      { learnerId: profile.learnerId, scenarioId: "cafe", sessionId: null },
      now,
    );
    expect(res).toEqual({ error: "No voice time left today." });
  });
});
