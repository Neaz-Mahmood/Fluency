import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { sessionFeedback, sessions, sessionTurns } from "@/lib/db/schema";
import { ensureLearnerProfile } from "@/lib/learner";
import { newLearnerId } from "@/lib/learner-id";
import {
  endSession,
  findOpenSession,
  findSession,
  listSessions,
  loadTurns,
  recordFirstAudio,
  saveExchange,
  startSession,
} from "@/lib/sessions";
import { createTestDb, resetTestDb } from "@/test/db";

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

async function turnsOf(sessionId: string) {
  return db
    .select({
      position: sessionTurns.position,
      role: sessionTurns.role,
      content: sessionTurns.content,
      inputMode: sessionTurns.inputMode,
    })
    .from(sessionTurns)
    .where(eq(sessionTurns.sessionId, sessionId))
    .orderBy(asc(sessionTurns.position));
}

describe("startSession", () => {
  it("starts a conversation session for the learner", async () => {
    const learnerId = await newLearner();
    const session = await startSession(db, {
      learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });
    expect(session).toMatchObject({ learnerId, scenarioId: "cafe", mode: "conversation" });
  });
});

describe("findOpenSession", () => {
  it("finds the learner's own session, with or without the scenario", async () => {
    const learnerId = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });

    expect(await findOpenSession(db, { learnerId, sessionId, scenarioId: "cafe" })).toMatchObject({
      sessionId,
    });
    expect(await findOpenSession(db, { learnerId, sessionId })).toMatchObject({ sessionId });
  });

  it("never finds another learner's session", async () => {
    const owner = await newLearner();
    const intruder = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId: owner,
      mode: "conversation",
      scenarioId: "cafe",
    });

    expect(await findOpenSession(db, { learnerId: intruder, sessionId })).toBeNull();
  });

  it("ignores a session for another scenario", async () => {
    const learnerId = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });

    expect(
      await findOpenSession(db, { learnerId, sessionId, scenarioId: "job-interview" }),
    ).toBeNull();
  });

  it("finds a placement session with mode placement and not with a scenario", async () => {
    const learnerId = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId,
      mode: "placement",
      scenarioId: null,
    });

    expect(await findOpenSession(db, { learnerId, sessionId, mode: "placement" })).toMatchObject({
      sessionId,
      mode: "placement",
    });
    expect(await findOpenSession(db, { learnerId, sessionId, scenarioId: "cafe" })).toBeNull();
  });

  it("ignores a session that has ended", async () => {
    const learnerId = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });
    await db.update(sessions).set({ endedAt: new Date() }).where(eq(sessions.sessionId, sessionId));

    expect(await findOpenSession(db, { learnerId, sessionId })).toBeNull();
  });

  it("returns null for an unknown session id", async () => {
    const learnerId = await newLearner();
    expect(await findOpenSession(db, { learnerId, sessionId: newLearnerId() })).toBeNull();
  });
});

describe("loadTurns", () => {
  it("returns the saved turns in order", async () => {
    const learnerId = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });
    await saveExchange(db, {
      sessionId,
      userText: "Hi",
      inputMode: "voice",
      replyText: "Hello!",
      replyTurnId: crypto.randomUUID(),
      firstTokenMs: 100,
    });
    await saveExchange(db, {
      sessionId,
      userText: "A latte.",
      inputMode: "typed",
      replyText: "",
      replyTurnId: crypto.randomUUID(),
      firstTokenMs: 0,
    });

    const turns = await loadTurns(db, sessionId);
    expect(turns.map(({ role, content, inputMode }) => ({ role, content, inputMode }))).toEqual([
      { role: "user", content: "Hi", inputMode: "voice" },
      { role: "assistant", content: "Hello!", inputMode: null },
      { role: "user", content: "A latte.", inputMode: "typed" },
    ]);
    expect(new Set(turns.map((turn) => turn.id)).size).toBe(3);
  });
});

describe("endSession", () => {
  it("ends the owner's open session", async () => {
    const owner = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId: owner,
      mode: "placement",
      scenarioId: null,
    });

    const ended = await endSession(db, { learnerId: owner, sessionId });
    expect(ended).toMatchObject({ sessionId, learnerId: owner });
    expect(ended?.endedAt).toBeInstanceOf(Date);

    const found = await findSession(db, { learnerId: owner, sessionId });
    expect(found?.endedAt).toEqual(ended?.endedAt);
  });

  it("returns null for another learner", async () => {
    const owner = await newLearner();
    const intruder = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId: owner,
      mode: "placement",
      scenarioId: null,
    });

    expect(await endSession(db, { learnerId: intruder, sessionId })).toBeNull();
  });

  it("returns null for an already-ended session", async () => {
    const owner = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId: owner,
      mode: "placement",
      scenarioId: null,
    });

    const first = await endSession(db, { learnerId: owner, sessionId });
    expect(first).not.toBeNull();
    expect(await endSession(db, { learnerId: owner, sessionId })).toBeNull();
  });
});

describe("saveExchange", () => {
  it("appends the learner's turn and the reply in order", async () => {
    const learnerId = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });

    await saveExchange(db, {
      sessionId,
      userText: "Hi",
      inputMode: "voice",
      replyText: "Hello! ",
      replyTurnId: crypto.randomUUID(),
      firstTokenMs: 120,
    });
    await saveExchange(db, {
      sessionId,
      userText: "A latte, please.",
      inputMode: "typed",
      replyText: "Hot or iced?",
      replyTurnId: crypto.randomUUID(),
      firstTokenMs: 140,
    });

    expect(await turnsOf(sessionId)).toEqual([
      { position: 0, role: "user", content: "Hi", inputMode: "voice" },
      { position: 1, role: "assistant", content: "Hello!", inputMode: null },
      { position: 2, role: "user", content: "A latte, please.", inputMode: "typed" },
      { position: 3, role: "assistant", content: "Hot or iced?", inputMode: null },
    ]);
  });

  it("stores the reply turn id and first token latency on the assistant turn", async () => {
    const learnerId = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });
    const replyTurnId = crypto.randomUUID();

    await saveExchange(db, {
      sessionId,
      userText: "Hi",
      inputMode: "voice",
      replyText: "Hello!",
      replyTurnId,
      firstTokenMs: 250,
    });

    const [assistantTurn] = await db
      .select({
        turnId: sessionTurns.turnId,
        role: sessionTurns.role,
        firstTokenMs: sessionTurns.firstTokenMs,
        firstAudioMs: sessionTurns.firstAudioMs,
      })
      .from(sessionTurns)
      .where(eq(sessionTurns.turnId, replyTurnId));

    expect(assistantTurn).toEqual({
      turnId: replyTurnId,
      role: "assistant",
      firstTokenMs: 250,
      firstAudioMs: null,
    });
  });

  it("saves only the learner's turn when the reply is empty", async () => {
    const learnerId = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });

    await saveExchange(db, {
      sessionId,
      userText: "Hi",
      inputMode: null,
      replyText: "  ",
      replyTurnId: crypto.randomUUID(),
      firstTokenMs: 0,
    });

    expect(await turnsOf(sessionId)).toEqual([
      { position: 0, role: "user", content: "Hi", inputMode: null },
    ]);
  });

  it("gives concurrent saves distinct positions", async () => {
    const learnerId = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });

    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        saveExchange(db, {
          sessionId,
          userText: `Turn ${index}`,
          inputMode: "typed",
          replyText: `Reply ${index}`,
          replyTurnId: crypto.randomUUID(),
          firstTokenMs: 100 + index,
        }),
      ),
    );

    const positions = (await turnsOf(sessionId)).map((turn) => turn.position);
    expect(positions).toEqual(Array.from({ length: 10 }, (_, index) => index));
  });
});

describe("findSession", () => {
  it("returns an ended session for its owner and null for another learner", async () => {
    const owner = await newLearner();
    const other = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId: owner,
      mode: "conversation",
      scenarioId: "cafe",
    });
    await db.update(sessions).set({ endedAt: new Date() }).where(eq(sessions.sessionId, sessionId));

    const found = await findSession(db, { learnerId: owner, sessionId });
    expect(found).toMatchObject({ sessionId, learnerId: owner });
    expect(found?.endedAt).toBeInstanceOf(Date);

    expect(await findSession(db, { learnerId: other, sessionId })).toBeNull();
  });
});

describe("listSessions", () => {
  it("returns only the learner's own sessions, newest first, with correct turnCount", async () => {
    const owner = await newLearner();
    const other = await newLearner();

    const older = await startSession(db, {
      learnerId: owner,
      mode: "conversation",
      scenarioId: "cafe",
    });
    await db
      .update(sessions)
      .set({ startedAt: new Date("2026-01-01T10:00:00Z") })
      .where(eq(sessions.sessionId, older.sessionId));

    const newer = await startSession(db, {
      learnerId: owner,
      mode: "conversation",
      scenarioId: "job-interview",
    });
    await db
      .update(sessions)
      .set({ startedAt: new Date("2026-01-02T10:00:00Z") })
      .where(eq(sessions.sessionId, newer.sessionId));

    const otherSession = await startSession(db, {
      learnerId: other,
      mode: "conversation",
      scenarioId: "cafe",
    });
    await saveExchange(db, {
      sessionId: otherSession.sessionId,
      userText: "Other learner",
      inputMode: "voice",
      replyText: "Reply to other",
      replyTurnId: crypto.randomUUID(),
      firstTokenMs: 80,
    });

    await saveExchange(db, {
      sessionId: older.sessionId,
      userText: "Coffee please",
      inputMode: "voice",
      replyText: "Sure thing!",
      replyTurnId: crypto.randomUUID(),
      firstTokenMs: 90,
    });

    await saveExchange(db, {
      sessionId: newer.sessionId,
      userText: "Hello, I am ready.",
      inputMode: "typed",
      replyText: "Welcome! Tell me about yourself.",
      replyTurnId: crypto.randomUUID(),
      firstTokenMs: 110,
    });
    await saveExchange(db, {
      sessionId: newer.sessionId,
      userText: "I am a software engineer.",
      inputMode: "typed",
      replyText: "Great, how many years?",
      replyTurnId: crypto.randomUUID(),
      firstTokenMs: 95,
    });

    const sessionsList = await listSessions(db, owner);
    expect(sessionsList).toHaveLength(2);
    expect(sessionsList[0]).toMatchObject({
      sessionId: newer.sessionId,
      scenarioId: "job-interview",
      mode: "conversation",
      turnCount: 4,
    });
    expect(sessionsList[1]).toMatchObject({
      sessionId: older.sessionId,
      scenarioId: "cafe",
      mode: "conversation",
      turnCount: 2,
    });
  });
});

describe("recordFirstAudio", () => {
  it("sets firstAudioMs for the owner of the session", async () => {
    const owner = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId: owner,
      mode: "conversation",
      scenarioId: "cafe",
    });
    const replyTurnId = crypto.randomUUID();

    await saveExchange(db, {
      sessionId,
      userText: "Hi",
      inputMode: "voice",
      replyText: "Hello!",
      replyTurnId,
      firstTokenMs: 150,
    });

    const recorded = await recordFirstAudio(db, {
      learnerId: owner,
      turnId: replyTurnId,
      firstAudioMs: 420,
    });
    expect(recorded).toBe(true);

    const [assistantTurn] = await db
      .select({ firstAudioMs: sessionTurns.firstAudioMs })
      .from(sessionTurns)
      .where(eq(sessionTurns.turnId, replyTurnId));
    expect(assistantTurn?.firstAudioMs).toBe(420);
  });

  it("returns false and changes nothing for another learner", async () => {
    const owner = await newLearner();
    const other = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId: owner,
      mode: "conversation",
      scenarioId: "cafe",
    });
    const replyTurnId = crypto.randomUUID();

    await saveExchange(db, {
      sessionId,
      userText: "Hi",
      inputMode: "voice",
      replyText: "Hello!",
      replyTurnId,
      firstTokenMs: 150,
    });

    const recorded = await recordFirstAudio(db, {
      learnerId: other,
      turnId: replyTurnId,
      firstAudioMs: 420,
    });
    expect(recorded).toBe(false);

    const [assistantTurn] = await db
      .select({ firstAudioMs: sessionTurns.firstAudioMs })
      .from(sessionTurns)
      .where(eq(sessionTurns.turnId, replyTurnId));
    expect(assistantTurn?.firstAudioMs).toBeNull();
  });

  it("returns false for an unknown turn id", async () => {
    const learnerId = await newLearner();
    const recorded = await recordFirstAudio(db, {
      learnerId,
      turnId: crypto.randomUUID(),
      firstAudioMs: 420,
    });
    expect(recorded).toBe(false);
  });
});

describe("session_feedback", () => {
  it("is deleted with its session", async () => {
    const learnerId = await newLearner();
    const { sessionId } = await startSession(db, {
      learnerId,
      mode: "conversation",
      scenarioId: "cafe",
    });

    await db.insert(sessionFeedback).values({ sessionId, learnerId });

    await db.delete(sessions).where(eq(sessions.sessionId, sessionId));

    const remaining = await db
      .select()
      .from(sessionFeedback)
      .where(eq(sessionFeedback.sessionId, sessionId));
    expect(remaining).toEqual([]);
  });
});
