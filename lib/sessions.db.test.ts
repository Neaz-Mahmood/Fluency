import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { sessions, sessionTurns } from "@/lib/db/schema";
import { ensureLearnerProfile } from "@/lib/learner";
import { newLearnerId } from "@/lib/learner-id";
import { resolveSession, saveExchange } from "@/lib/sessions";
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

describe("resolveSession", () => {
  it("starts a session on the first turn", async () => {
    const learnerId = await newLearner();
    const session = await resolveSession(db, { learnerId, scenarioId: "cafe" });
    expect(session).toMatchObject({ learnerId, scenarioId: "cafe", mode: "conversation" });
  });

  it("reuses the learner's own session for the same scenario", async () => {
    const learnerId = await newLearner();
    const first = await resolveSession(db, { learnerId, scenarioId: "cafe" });
    const again = await resolveSession(db, {
      learnerId,
      scenarioId: "cafe",
      sessionId: first.sessionId,
    });
    expect(again.sessionId).toBe(first.sessionId);
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

  it("never reuses another learner's session", async () => {
    const owner = await newLearner();
    const intruder = await newLearner();
    const theirs = await resolveSession(db, { learnerId: owner, scenarioId: "cafe" });

    const mine = await resolveSession(db, {
      learnerId: intruder,
      scenarioId: "cafe",
      sessionId: theirs.sessionId,
    });

    expect(mine.sessionId).not.toBe(theirs.sessionId);
    expect(mine.learnerId).toBe(intruder);
  });

  it("starts a new session when the scenario changes", async () => {
    const learnerId = await newLearner();
    const cafe = await resolveSession(db, { learnerId, scenarioId: "cafe" });
    const interview = await resolveSession(db, {
      learnerId,
      scenarioId: "job-interview",
      sessionId: cafe.sessionId,
    });
    expect(interview.sessionId).not.toBe(cafe.sessionId);
    expect(interview.scenarioId).toBe("job-interview");
  });

  it("starts a new session when the old one has ended", async () => {
    const learnerId = await newLearner();
    const old = await resolveSession(db, { learnerId, scenarioId: "cafe" });
    await db
      .update(sessions)
      .set({ endedAt: new Date() })
      .where(eq(sessions.sessionId, old.sessionId));

    const next = await resolveSession(db, {
      learnerId,
      scenarioId: "cafe",
      sessionId: old.sessionId,
    });
    expect(next.sessionId).not.toBe(old.sessionId);
  });

  it("starts a new session for an unknown session id", async () => {
    const learnerId = await newLearner();
    const session = await resolveSession(db, {
      learnerId,
      scenarioId: "cafe",
      sessionId: newLearnerId(),
    });
    expect(session.learnerId).toBe(learnerId);
  });
});

describe("saveExchange", () => {
  it("appends the learner's turn and the reply in order", async () => {
    const learnerId = await newLearner();
    const { sessionId } = await resolveSession(db, { learnerId, scenarioId: "cafe" });

    await saveExchange(db, { sessionId, userText: "Hi", inputMode: "voice", replyText: "Hello! " });
    await saveExchange(db, {
      sessionId,
      userText: "A latte, please.",
      inputMode: "typed",
      replyText: "Hot or iced?",
    });

    expect(await turnsOf(sessionId)).toEqual([
      { position: 0, role: "user", content: "Hi", inputMode: "voice" },
      { position: 1, role: "assistant", content: "Hello!", inputMode: null },
      { position: 2, role: "user", content: "A latte, please.", inputMode: "typed" },
      { position: 3, role: "assistant", content: "Hot or iced?", inputMode: null },
    ]);
  });

  it("saves only the learner's turn when the reply is empty", async () => {
    const learnerId = await newLearner();
    const { sessionId } = await resolveSession(db, { learnerId, scenarioId: "cafe" });

    await saveExchange(db, { sessionId, userText: "Hi", inputMode: null, replyText: "  " });

    expect(await turnsOf(sessionId)).toEqual([
      { position: 0, role: "user", content: "Hi", inputMode: null },
    ]);
  });

  it("gives concurrent saves distinct positions", async () => {
    const learnerId = await newLearner();
    const { sessionId } = await resolveSession(db, { learnerId, scenarioId: "cafe" });

    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        saveExchange(db, {
          sessionId,
          userText: `Turn ${index}`,
          inputMode: "typed",
          replyText: `Reply ${index}`,
        }),
      ),
    );

    const positions = (await turnsOf(sessionId)).map((turn) => turn.position);
    expect(positions).toEqual(Array.from({ length: 10 }, (_, index) => index));
  });
});
