import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { sessionFeedback, sessions, sessionTurns, type LearnerProfile } from "@/lib/db/schema";
import { ensureLearnerProfile } from "@/lib/learner";
import { newLearnerId } from "@/lib/learner-id";
import { finishConversation } from "@/lib/session-end";
import { endSession, startSession } from "@/lib/sessions";
import {
  claimStaleJobs,
  failExhaustedJobs,
  findIdleSessions,
  sweep,
  type SweepJobs,
} from "@/lib/sweep";
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

async function createConversationSession(learnerId: string) {
  const session = await startSession(db, {
    learnerId,
    mode: "conversation",
    scenarioId: "cafe",
  });
  return session.sessionId;
}

function createFakeJobs() {
  const conversationCalls: {
    learner: LearnerProfile;
    sessionId: string;
    options: { spoken: boolean };
  }[] = [];
  const feedbackCalls: {
    learner: Pick<LearnerProfile, "learnerId">;
    sessionId: string;
    mode: "conversation" | "writing";
  }[] = [];
  const pronunciationCalls: { learner: Pick<LearnerProfile, "learnerId">; sessionId: string }[] =
    [];

  const fakeJobs: SweepJobs = {
    runConversationJobs: async (learner, sessionId, options) => {
      conversationCalls.push({ learner, sessionId, options });
    },
    runFeedback: async (learner, sessionId, mode) => {
      feedbackCalls.push({ learner, sessionId, mode });
    },
    runPronunciationFeedback: async (learner, sessionId) => {
      pronunciationCalls.push({ learner, sessionId });
    },
  };

  return { fakeJobs, conversationCalls, feedbackCalls, pronunciationCalls };
}

describe("findIdleSessions", () => {
  it("finds a session whose last turn is 31 minutes before now", async () => {
    const learnerId = await newLearner();
    const sessionId = await createConversationSession(learnerId);
    await db.insert(sessionTurns).values({
      sessionId,
      position: 0,
      role: "user",
      content: "Hello",
      inputMode: "typed",
    });

    const now = new Date(Date.now() + 31 * 60_000);
    const result = await findIdleSessions(db, { now, limit: 10 });
    expect(result).toEqual([{ sessionId, learnerId }]);
  });

  it("does not find a session whose last turn is 29 minutes before now", async () => {
    const learnerId = await newLearner();
    const sessionId = await createConversationSession(learnerId);
    await db.insert(sessionTurns).values({
      sessionId,
      position: 0,
      role: "user",
      content: "Hello",
      inputMode: "typed",
    });

    const now = new Date(Date.now() + 29 * 60_000);
    const result = await findIdleSessions(db, { now, limit: 10 });
    expect(result).toEqual([]);
  });

  it("does not find an ended session", async () => {
    const learnerId = await newLearner();
    const sessionId = await createConversationSession(learnerId);
    await db.insert(sessionTurns).values({
      sessionId,
      position: 0,
      role: "user",
      content: "Hello",
      inputMode: "typed",
    });
    await endSession(db, { learnerId, sessionId });

    const now = new Date(Date.now() + 31 * 60_000);
    const result = await findIdleSessions(db, { now, limit: 10 });
    expect(result).toEqual([]);
  });

  it("does not find a session without user turns", async () => {
    const learnerId = await newLearner();
    const sessionId = await createConversationSession(learnerId);
    await db.insert(sessionTurns).values({
      sessionId,
      position: 0,
      role: "assistant",
      content: "Hi!",
      inputMode: null,
    });

    const now = new Date(Date.now() + 31 * 60_000);
    const result = await findIdleSessions(db, { now, limit: 10 });
    expect(result).toEqual([]);
  });

  it("excludes exceptSessionId", async () => {
    const learnerId = await newLearner();
    const sessionId = await createConversationSession(learnerId);
    await db.insert(sessionTurns).values({
      sessionId,
      position: 0,
      role: "user",
      content: "Hello",
      inputMode: "typed",
    });

    const now = new Date(Date.now() + 31 * 60_000);
    const result = await findIdleSessions(db, { now, exceptSessionId: sessionId, limit: 10 });
    expect(result).toEqual([]);
  });

  it("does not find a placement session", async () => {
    const learnerId = await newLearner();
    const session = await startSession(db, {
      learnerId,
      mode: "placement",
      scenarioId: null,
    });
    await db.insert(sessionTurns).values({
      sessionId: session.sessionId,
      position: 0,
      role: "user",
      content: "Hello",
      inputMode: "typed",
    });

    const now = new Date(Date.now() + 31 * 60_000);
    const result = await findIdleSessions(db, { now, limit: 10 });
    expect(result).toEqual([]);
  });

  it("scopes by learnerId", async () => {
    const learnerId1 = await newLearner();
    const sessionId1 = await createConversationSession(learnerId1);
    await db.insert(sessionTurns).values({
      sessionId: sessionId1,
      position: 0,
      role: "user",
      content: "Hello 1",
      inputMode: "typed",
    });

    const learnerId2 = await newLearner();
    const sessionId2 = await createConversationSession(learnerId2);
    await db.insert(sessionTurns).values({
      sessionId: sessionId2,
      position: 0,
      role: "user",
      content: "Hello 2",
      inputMode: "typed",
    });

    const now = new Date(Date.now() + 31 * 60_000);
    const result = await findIdleSessions(db, { now, learnerId: learnerId1, limit: 10 });
    expect(result).toEqual([{ sessionId: sessionId1, learnerId: learnerId1 }]);
  });
});

describe("claimStaleJobs", () => {
  it("claims a pending row with attempts 1, 6 minutes stale, and increments attempts to 2", async () => {
    const learnerId = await newLearner();
    const sessionId = await createConversationSession(learnerId);
    await db.insert(sessionFeedback).values({
      sessionId,
      learnerId,
      status: "pending",
      attempts: 1,
    });

    const now = new Date(Date.now() + 6 * 60_000);
    const claimed = await claimStaleJobs(db, { now, limit: 10 });
    expect(claimed).toEqual([
      {
        sessionId,
        learnerId,
        feedbackPending: true,
        pronunciationPending: false,
      },
    ]);

    const [row] = await db
      .select()
      .from(sessionFeedback)
      .where(eq(sessionFeedback.sessionId, sessionId));
    expect(row.attempts).toBe(2);
  });

  it("returns nothing when claiming again at the same now (the lease)", async () => {
    const learnerId = await newLearner();
    const sessionId = await createConversationSession(learnerId);
    await db.insert(sessionFeedback).values({
      sessionId,
      learnerId,
      status: "pending",
      attempts: 1,
    });

    const now = new Date(Date.now() + 6 * 60_000);
    const first = await claimStaleJobs(db, { now, limit: 10 });
    expect(first).toHaveLength(1);

    const second = await claimStaleJobs(db, { now, limit: 10 });
    expect(second).toEqual([]);
  });

  it("does not claim rows with attempts >= 3 or status done", async () => {
    const learnerId = await newLearner();
    const s1 = await createConversationSession(learnerId);
    await db.insert(sessionFeedback).values({
      sessionId: s1,
      learnerId,
      status: "pending",
      attempts: 3,
    });

    const s2 = await createConversationSession(learnerId);
    await db.insert(sessionFeedback).values({
      sessionId: s2,
      learnerId,
      status: "done",
      attempts: 1,
    });

    const now = new Date(Date.now() + 6 * 60_000);
    const claimed = await claimStaleJobs(db, { now, limit: 10 });
    expect(claimed).toEqual([]);
  });

  it("claims pronunciation_status pending with pronunciationPending: true", async () => {
    const learnerId = await newLearner();
    const sessionId = await createConversationSession(learnerId);
    await db.insert(sessionFeedback).values({
      sessionId,
      learnerId,
      status: "done",
      pronunciationStatus: "pending",
      attempts: 1,
    });

    const now = new Date(Date.now() + 6 * 60_000);
    const claimed = await claimStaleJobs(db, { now, limit: 10 });
    expect(claimed).toEqual([
      {
        sessionId,
        learnerId,
        feedbackPending: false,
        pronunciationPending: true,
      },
    ]);
  });
});

describe("failExhaustedJobs", () => {
  it("fails exhausted and stale jobs while leaving the other status untouched", async () => {
    const learnerId = await newLearner();

    const s1 = await createConversationSession(learnerId);
    await db.insert(sessionFeedback).values({
      sessionId: s1,
      learnerId,
      status: "pending",
      pronunciationStatus: "done",
      attempts: 3,
    });

    const s2 = await createConversationSession(learnerId);
    await db.insert(sessionFeedback).values({
      sessionId: s2,
      learnerId,
      status: "done",
      pronunciationStatus: "pending",
      attempts: 3,
    });

    const now = new Date(Date.now() + 6 * 60_000);
    const failedCount = await failExhaustedJobs(db, { now });
    expect(failedCount).toBe(2);

    const [row1] = await db.select().from(sessionFeedback).where(eq(sessionFeedback.sessionId, s1));
    expect(row1.status).toBe("failed");
    expect(row1.pronunciationStatus).toBe("done");

    const [row2] = await db.select().from(sessionFeedback).where(eq(sessionFeedback.sessionId, s2));
    expect(row2.status).toBe("done");
    expect(row2.pronunciationStatus).toBe("failed");
  });

  it("leaves fresh jobs or jobs under the attempt limit unchanged", async () => {
    const learnerId = await newLearner();

    const sFresh = await createConversationSession(learnerId);
    await db.insert(sessionFeedback).values({
      sessionId: sFresh,
      learnerId,
      status: "pending",
      attempts: 3,
    });

    const sUnderLimit = await createConversationSession(learnerId);
    await db.insert(sessionFeedback).values({
      sessionId: sUnderLimit,
      learnerId,
      status: "pending",
      attempts: 2,
    });

    const now = new Date(Date.now() + 6 * 60_000);
    // Make sFresh updated_at fresh relative to now
    await db
      .update(sessionFeedback)
      .set({ updatedAt: now })
      .where(eq(sessionFeedback.sessionId, sFresh));

    const failedCount = await failExhaustedJobs(db, { now });
    expect(failedCount).toBe(0);

    const [rowFresh] = await db
      .select()
      .from(sessionFeedback)
      .where(eq(sessionFeedback.sessionId, sFresh));
    expect(rowFresh.status).toBe("pending");

    const [rowUnder] = await db
      .select()
      .from(sessionFeedback)
      .where(eq(sessionFeedback.sessionId, sUnderLimit));
    expect(rowUnder.status).toBe("pending");
  });
});

describe("sweep", () => {
  it("ends an idle session once and runs runConversationJobs once", async () => {
    const learnerId = await newLearner();
    const sessionId = await createConversationSession(learnerId);
    await db.insert(sessionTurns).values({
      sessionId,
      position: 0,
      role: "user",
      content: "Hello",
      inputMode: "voice",
    });

    const { fakeJobs, conversationCalls } = createFakeJobs();
    const now = new Date(Date.now() + 31 * 60_000);

    const result = await sweep({ now, db }, fakeJobs);
    expect(result).toEqual({ ended: 1, retried: 0, failed: 0 });
    expect(conversationCalls).toHaveLength(1);
    expect(conversationCalls[0].sessionId).toBe(sessionId);
    expect(conversationCalls[0].learner.learnerId).toBe(learnerId);
    expect(conversationCalls[0].options).toEqual({ spoken: true });

    const [endedSession] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.sessionId, sessionId));
    expect(endedSession.endedAt).not.toBeNull();
  });

  it("ends an idle session once in total when two sweeps run concurrently", async () => {
    const learnerId = await newLearner();
    const sessionId = await createConversationSession(learnerId);
    await db.insert(sessionTurns).values({
      sessionId,
      position: 0,
      role: "user",
      content: "Hello",
      inputMode: "voice",
    });

    const { fakeJobs, conversationCalls } = createFakeJobs();
    const now = new Date(Date.now() + 31 * 60_000);

    const [r1, r2] = await Promise.all([
      sweep({ now, db }, fakeJobs),
      sweep({ now, db }, fakeJobs),
    ]);

    expect(r1.ended + r2.ended).toBe(1);
    expect(conversationCalls).toHaveLength(1);
  });

  it("retries a stale writing-session feedback with mode writing", async () => {
    const learnerId = await newLearner();
    const session = await startSession(db, {
      learnerId,
      mode: "writing",
      scenarioId: null,
    });
    await endSession(db, { learnerId, sessionId: session.sessionId });
    await db.insert(sessionFeedback).values({
      sessionId: session.sessionId,
      learnerId,
      status: "pending",
      attempts: 1,
    });

    const { fakeJobs, feedbackCalls } = createFakeJobs();
    const now = new Date(Date.now() + 6 * 60_000);

    const res = await sweep({ now, db }, fakeJobs);
    expect(res.retried).toBe(1);
    expect(feedbackCalls).toHaveLength(1);
    expect(feedbackCalls[0].sessionId).toBe(session.sessionId);
    expect(feedbackCalls[0].mode).toBe("writing");
  });

  it("returns the right counts for ended, retried, and failed jobs", async () => {
    const learnerId = await newLearner();

    // 1. Idle session -> should be ended
    const idleSessionId = await createConversationSession(learnerId);
    await db.insert(sessionTurns).values({
      sessionId: idleSessionId,
      position: 0,
      role: "user",
      content: "Hello",
      inputMode: "typed",
    });

    // 2. Stale job with attempts 1 -> should be retried
    const staleSessionId = await createConversationSession(learnerId);
    await endSession(db, { learnerId, sessionId: staleSessionId });
    await db.insert(sessionFeedback).values({
      sessionId: staleSessionId,
      learnerId,
      status: "pending",
      attempts: 1,
    });

    // 3. Exhausted stale job with attempts 3 -> should be marked failed
    const exhaustedSessionId = await createConversationSession(learnerId);
    await endSession(db, { learnerId, sessionId: exhaustedSessionId });
    await db.insert(sessionFeedback).values({
      sessionId: exhaustedSessionId,
      learnerId,
      status: "pending",
      attempts: 3,
    });

    const { fakeJobs } = createFakeJobs();
    const now = new Date(Date.now() + 31 * 60_000);

    const res = await sweep({ now, db }, fakeJobs);
    expect(res).toEqual({ ended: 1, retried: 1, failed: 1 });
  });
});

describe("finishConversation", () => {
  it("returns { spoken: true } for a session with a voice user turn and sets both statuses pending; second call returns null", async () => {
    const learnerId = await newLearner();
    const sessionId = await createConversationSession(learnerId);
    await db.insert(sessionTurns).values({
      sessionId,
      position: 0,
      role: "user",
      content: "Can I have a coffee?",
      inputMode: "voice",
    });

    const first = await finishConversation(db, { learnerId }, sessionId);
    expect(first).toEqual({ spoken: true });

    const [feedbackRow] = await db
      .select()
      .from(sessionFeedback)
      .where(eq(sessionFeedback.sessionId, sessionId));
    expect(feedbackRow).toBeDefined();
    expect(feedbackRow.status).toBe("pending");
    expect(feedbackRow.pronunciationStatus).toBe("pending");
    expect(feedbackRow.attempts).toBe(1);

    const second = await finishConversation(db, { learnerId }, sessionId);
    expect(second).toBeNull();
  });

  it("returns { spoken: false } for a session with only typed user turns", async () => {
    const learnerId = await newLearner();
    const sessionId = await createConversationSession(learnerId);
    await db.insert(sessionTurns).values({
      sessionId,
      position: 0,
      role: "user",
      content: "Hello",
      inputMode: "typed",
    });

    const result = await finishConversation(db, { learnerId }, sessionId);
    expect(result).toEqual({ spoken: false });

    const [feedbackRow] = await db
      .select()
      .from(sessionFeedback)
      .where(eq(sessionFeedback.sessionId, sessionId));
    expect(feedbackRow).toBeDefined();
    expect(feedbackRow.status).toBe("pending");
    expect(feedbackRow.pronunciationStatus).toBeNull();
    expect(feedbackRow.attempts).toBe(1);
  });
});
