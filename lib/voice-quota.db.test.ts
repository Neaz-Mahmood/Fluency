import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { voiceUsage } from "@/lib/db/schema";
import { ensureLearnerProfile } from "@/lib/learner";
import { newLearnerId } from "@/lib/learner-id";
import { quotaDay, recordVoiceSeconds, remainingVoiceSeconds } from "@/lib/voice-quota";
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

describe("voice-quota database tests", () => {
  it("gives a new learner 300 seconds remaining", async () => {
    const learnerId = await newLearner();
    const now = new Date("2026-10-22T12:00:00Z");

    const remaining = await remainingVoiceSeconds(db, learnerId, now);
    expect(remaining).toBe(300);
  });

  it("leaves 80 seconds when recording 120 then 100, and remainingVoiceSeconds agrees", async () => {
    const learnerId = await newLearner();
    const now = new Date("2026-10-22T12:00:00Z");

    const firstRemaining = await recordVoiceSeconds(db, learnerId, 120, now);
    expect(firstRemaining).toBe(180);

    const secondRemaining = await recordVoiceSeconds(db, learnerId, 100, now);
    expect(secondRemaining).toBe(80);

    const currentRemaining = await remainingVoiceSeconds(db, learnerId, now);
    expect(currentRemaining).toBe(80);
  });

  it("recording past the limit (250 + 100) returns 0, and the row holds 350", async () => {
    const learnerId = await newLearner();
    const now = new Date("2026-10-22T12:00:00Z");

    await recordVoiceSeconds(db, learnerId, 250, now);
    const remaining = await recordVoiceSeconds(db, learnerId, 100, now);
    expect(remaining).toBe(0);

    const [row] = await db
      .select()
      .from(voiceUsage)
      .where(and(eq(voiceUsage.learnerId, learnerId), eq(voiceUsage.day, quotaDay(now))));

    expect(row).toBeDefined();
    expect(row?.secondsUsed).toBe(350);

    expect(await remainingVoiceSeconds(db, learnerId, now)).toBe(0);
  });

  it("lands usage at 2026-10-22T17:59Z and 2026-10-22T18:01Z on different days so the second starts fresh", async () => {
    const learnerId = await newLearner();
    const day1Time = new Date("2026-10-22T17:59:00Z");
    const day2Time = new Date("2026-10-22T18:01:00Z");

    expect(quotaDay(day1Time)).toBe("2026-10-22");
    expect(quotaDay(day2Time)).toBe("2026-10-23");

    const day1Remaining = await recordVoiceSeconds(db, learnerId, 200, day1Time);
    expect(day1Remaining).toBe(100);

    expect(await remainingVoiceSeconds(db, learnerId, day2Time)).toBe(300);

    const day2Remaining = await recordVoiceSeconds(db, learnerId, 50, day2Time);
    expect(day2Remaining).toBe(250);

    expect(await remainingVoiceSeconds(db, learnerId, day1Time)).toBe(100);
  });

  it("does not share usage between two learners", async () => {
    const learner1 = await newLearner();
    const learner2 = await newLearner();
    const now = new Date("2026-10-22T12:00:00Z");

    await recordVoiceSeconds(db, learner1, 150, now);

    expect(await remainingVoiceSeconds(db, learner1, now)).toBe(150);
    expect(await remainingVoiceSeconds(db, learner2, now)).toBe(300);

    await recordVoiceSeconds(db, learner2, 40, now);

    expect(await remainingVoiceSeconds(db, learner1, now)).toBe(150);
    expect(await remainingVoiceSeconds(db, learner2, now)).toBe(260);
  });

  it("throws when seconds is negative or non-integer", async () => {
    const learnerId = await newLearner();
    const now = new Date("2026-10-22T12:00:00Z");

    await expect(recordVoiceSeconds(db, learnerId, -1, now)).rejects.toThrow(
      "Voice seconds must be a non-negative integer.",
    );
    await expect(recordVoiceSeconds(db, learnerId, -100, now)).rejects.toThrow(
      "Voice seconds must be a non-negative integer.",
    );
    await expect(recordVoiceSeconds(db, learnerId, 10.5, now)).rejects.toThrow(
      "Voice seconds must be a non-negative integer.",
    );
    await expect(recordVoiceSeconds(db, learnerId, NaN, now)).rejects.toThrow(
      "Voice seconds must be a non-negative integer.",
    );
  });
});
