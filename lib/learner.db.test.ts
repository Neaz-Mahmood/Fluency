import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import {
  fsrsCards,
  fsrsReviewLogs,
  learnerErrorPatterns,
  learnerProfiles,
  sessions,
  sessionTurns,
  voiceUsage,
} from "@/lib/db/schema";
import { LEARNER_COOKIE, newLearnerId } from "@/lib/learner-id";
import { createTestDb, resetTestDb } from "@/test/db";
import { TEST_DATABASE_URL } from "@/test/db-url";

const cookieStore = vi.hoisted(() => ({
  current: undefined as string | undefined,
  deleted: [] as string[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === LEARNER_COOKIE && cookieStore.current ? { value: cookieStore.current } : undefined,
    delete: (name: string) => {
      cookieStore.deleted.push(name);
    },
  }),
}));

process.env.DATABASE_URL = TEST_DATABASE_URL;
const {
  deleteCurrentLearner,
  deleteLearner,
  ensureLearnerProfile,
  getLearner,
  LearnerUnavailableError,
} = await import("@/lib/learner");

const db = createTestDb();

beforeEach(async () => {
  await resetTestDb(db);
  cookieStore.current = undefined;
  cookieStore.deleted = [];
});

afterAll(async () => {
  await db.$client.end();
});

async function learnerCount() {
  return (await db.select().from(learnerProfiles)).length;
}

describe("ensureLearnerProfile", () => {
  it("creates the learner on first use with default settings", async () => {
    const id = newLearnerId();
    const profile = await ensureLearnerProfile(db, id);

    expect(profile).toMatchObject({
      learnerId: id,
      userId: null,
      nativeLanguage: null,
      targetLanguage: "en-US",
      cefrSpeaking: null,
    });
    expect(await learnerCount()).toBe(1);
  });

  it("reuses the same row on later requests", async () => {
    const id = newLearnerId();
    const first = await ensureLearnerProfile(db, id);
    const second = await ensureLearnerProfile(db, id);

    expect(second.createdAt).toEqual(first.createdAt);
    expect(await learnerCount()).toBe(1);
  });

  it("creates exactly one row when first requests arrive at the same time", async () => {
    const id = newLearnerId();
    await Promise.all(Array.from({ length: 8 }, () => ensureLearnerProfile(db, id)));
    expect(await learnerCount()).toBe(1);
  });

  it("keeps different learners apart", async () => {
    await ensureLearnerProfile(db, newLearnerId());
    await ensureLearnerProfile(db, newLearnerId());
    expect(await learnerCount()).toBe(2);
  });
});

describe("getLearner", () => {
  it("returns the learner for the cookie", async () => {
    const id = newLearnerId();
    cookieStore.current = id;
    expect((await getLearner()).learnerId).toBe(id);
    expect((await getLearner()).learnerId).toBe(id);
    expect(await learnerCount()).toBe(1);
  });

  it.each([undefined, "not-a-uuid"])("rejects a missing or invalid cookie (%j)", async (value) => {
    cookieStore.current = value;
    await expect(getLearner()).rejects.toBeInstanceOf(LearnerUnavailableError);
    expect(await learnerCount()).toBe(0);
  });
});

// One row in every learner table, so the delete tests cover every cascade.
async function seedLearner(db: Db, learnerId: string) {
  await ensureLearnerProfile(db, learnerId);
  const [session] = await db.insert(sessions).values({ learnerId, scenarioId: "cafe" }).returning();
  await db
    .insert(sessionTurns)
    .values({ sessionId: session!.sessionId, position: 0, role: "user", content: "Hi" });
  const [card] = await db
    .insert(fsrsCards)
    .values({
      learnerId,
      cardType: "VOCABULARY",
      targetItem: "agree",
      nativeTranslation: "estar de acuerdo",
    })
    .returning();
  await db.insert(fsrsReviewLogs).values({
    cardId: card!.cardId,
    learnerId,
    rating: 3,
    stateBefore: "New",
    stabilityBefore: 0,
    difficultyBefore: 0,
    elapsedDays: 0,
    scheduledDays: 0,
  });
  await db.insert(learnerErrorPatterns).values({
    learnerId,
    modality: "SPEAKING_GRAMMAR",
    errorCode: "U:VERB",
    description: "I am agree",
  });
  await db.insert(voiceUsage).values({ learnerId, day: "2026-10-20", secondsUsed: 42 });
}

// Rows per table for one learner. session_turns has no learner_id, so it goes through sessions.
async function rowsFor(db: Db, learnerId: string) {
  const learnerSessions = await db.select().from(sessions).where(eq(sessions.learnerId, learnerId));
  let turns = 0;
  for (const session of learnerSessions) {
    turns += (
      await db.select().from(sessionTurns).where(eq(sessionTurns.sessionId, session.sessionId))
    ).length;
  }
  const count = async (
    table:
      | typeof fsrsCards
      | typeof fsrsReviewLogs
      | typeof learnerErrorPatterns
      | typeof voiceUsage
      | typeof learnerProfiles,
  ) => (await db.select().from(table).where(eq(table.learnerId, learnerId))).length;

  return {
    learnerProfiles: await count(learnerProfiles),
    sessions: learnerSessions.length,
    sessionTurns: turns,
    fsrsCards: await count(fsrsCards),
    fsrsReviewLogs: await count(fsrsReviewLogs),
    learnerErrorPatterns: await count(learnerErrorPatterns),
    voiceUsage: await count(voiceUsage),
  };
}

const ONE_OF_EACH = {
  learnerProfiles: 1,
  sessions: 1,
  sessionTurns: 1,
  fsrsCards: 1,
  fsrsReviewLogs: 1,
  learnerErrorPatterns: 1,
  voiceUsage: 1,
};
const NONE = Object.fromEntries(Object.keys(ONE_OF_EACH).map((key) => [key, 0]));

describe("deleteLearner", () => {
  it("removes the learner's rows from every table and leaves other learners alone", async () => {
    const me = newLearnerId();
    const someoneElse = newLearnerId();
    await seedLearner(db, me);
    await seedLearner(db, someoneElse);
    expect(await rowsFor(db, me)).toEqual(ONE_OF_EACH);

    expect(await deleteLearner(db, me)).toBe(true);

    expect(await rowsFor(db, me)).toEqual(NONE);
    expect(await rowsFor(db, someoneElse)).toEqual(ONE_OF_EACH);
  });

  it("returns false when the learner doesn't exist", async () => {
    expect(await deleteLearner(db, newLearnerId())).toBe(false);
  });
});

describe("deleteCurrentLearner", () => {
  it("deletes the cookie's learner and clears the cookie", async () => {
    const me = newLearnerId();
    await seedLearner(db, me);
    cookieStore.current = me;

    await deleteCurrentLearner();

    expect(await rowsFor(db, me)).toEqual(NONE);
    expect(cookieStore.deleted).toEqual([LEARNER_COOKIE]);
  });

  it.each([undefined, "not-a-uuid"])(
    "still clears the cookie when there is no valid learner (%j)",
    async (value) => {
      const someoneElse = newLearnerId();
      await seedLearner(db, someoneElse);
      cookieStore.current = value;

      await deleteCurrentLearner();

      expect(cookieStore.deleted).toEqual([LEARNER_COOKIE]);
      expect(await rowsFor(db, someoneElse)).toEqual(ONE_OF_EACH);
    },
  );
});
