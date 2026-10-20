import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { learnerProfiles } from "@/lib/db/schema";
import { LEARNER_COOKIE, newLearnerId } from "@/lib/learner-id";
import { createTestDb, resetTestDb } from "@/test/db";
import { TEST_DATABASE_URL } from "@/test/db-url";

const cookieValue = vi.hoisted(() => ({ current: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === LEARNER_COOKIE && cookieValue.current ? { value: cookieValue.current } : undefined,
  }),
}));

process.env.DATABASE_URL = TEST_DATABASE_URL;
const { ensureLearnerProfile, getLearner, LearnerUnavailableError } = await import("@/lib/learner");

const db = createTestDb();

beforeEach(async () => {
  await resetTestDb(db);
  cookieValue.current = undefined;
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
    cookieValue.current = id;
    expect((await getLearner()).learnerId).toBe(id);
    expect((await getLearner()).learnerId).toBe(id);
    expect(await learnerCount()).toBe(1);
  });

  it.each([undefined, "not-a-uuid"])("rejects a missing or invalid cookie (%j)", async (value) => {
    cookieValue.current = value;
    await expect(getLearner()).rejects.toBeInstanceOf(LearnerUnavailableError);
    expect(await learnerCount()).toBe(0);
  });
});
