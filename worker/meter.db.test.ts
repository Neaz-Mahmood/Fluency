import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ensureLearnerProfile, setVoiceConsent } from "@/lib/learner";
import { recordVoiceSeconds, remainingVoiceSeconds } from "@/lib/voice-quota";
import { createTestDb, resetTestDb } from "@/test/db";
import { TEST_DATABASE_URL } from "@/test/db-url";
import { hasVoiceConsent, meterTick, startVoiceMeter } from "./meter";

process.env.DATABASE_URL = TEST_DATABASE_URL;

const db = createTestDb();

beforeEach(async () => {
  await resetTestDb(db);
});

afterAll(async () => {
  await db.$client.end();
});

describe("worker meter database tests", () => {
  describe("hasVoiceConsent", () => {
    it("returns false for an unknown learner", async () => {
      const unknownId = crypto.randomUUID();
      expect(await hasVoiceConsent(db, unknownId)).toBe(false);
    });

    it("returns false for a learner without consent", async () => {
      const learnerId = crypto.randomUUID();
      await ensureLearnerProfile(db, learnerId);
      expect(await hasVoiceConsent(db, learnerId)).toBe(false);
    });

    it("returns true for a learner with consent", async () => {
      const learnerId = crypto.randomUUID();
      await ensureLearnerProfile(db, learnerId);
      await setVoiceConsent(db, learnerId, true);
      expect(await hasVoiceConsent(db, learnerId)).toBe(true);
    });
  });

  describe("meterTick", () => {
    it("meters 15 s with consent and 0 s causes no change", async () => {
      const learnerId = crypto.randomUUID();
      await ensureLearnerProfile(db, learnerId);
      await setVoiceConsent(db, learnerId, true);

      const now = new Date();
      const res1 = await meterTick(db, learnerId, 15, now);
      expect(res1).toEqual({ remainingSeconds: 285, limit: null });
      expect(await remainingVoiceSeconds(db, learnerId, now)).toBe(285);

      const res2 = await meterTick(db, learnerId, 0, now);
      expect(res2).toEqual({ remainingSeconds: 285, limit: null });
      expect(await remainingVoiceSeconds(db, learnerId, now)).toBe(285);
    });

    it("uses up the last seconds and returns quota limit", async () => {
      const learnerId = crypto.randomUUID();
      await ensureLearnerProfile(db, learnerId);
      await setVoiceConsent(db, learnerId, true);

      const now = new Date();
      await recordVoiceSeconds(db, learnerId, 290, now);

      const res = await meterTick(db, learnerId, 15, now);
      expect(res).toEqual({ remainingSeconds: 0, limit: "quota" });
      expect(await remainingVoiceSeconds(db, learnerId, now)).toBe(0);
    });

    it("returns consent limit after consent is withdrawn even with time left", async () => {
      const learnerId = crypto.randomUUID();
      await ensureLearnerProfile(db, learnerId);
      await setVoiceConsent(db, learnerId, true);

      const now = new Date();
      await setVoiceConsent(db, learnerId, false);

      const res = await meterTick(db, learnerId, 10, now);
      expect(res).toEqual({ remainingSeconds: 290, limit: "consent" });
    });
  });

  describe("startVoiceMeter", () => {
    it("records leftover on stop and does not fire tick before interval", async () => {
      const learnerId = crypto.randomUUID();
      await ensureLearnerProfile(db, learnerId);
      await setVoiceConsent(db, learnerId, true);

      let fakeTime = 0;
      const clock = () => fakeTime;
      let tickCalls = 0;
      let limitCalls = 0;

      const meter = startVoiceMeter({
        db,
        learnerId,
        remainingSeconds: 300,
        onTick: () => {
          tickCalls++;
        },
        onLimit: () => {
          limitCalls++;
        },
        clock,
      });

      fakeTime = 7_400;
      await meter.stop();

      expect(tickCalls).toBe(0);
      expect(limitCalls).toBe(0);
      expect(await remainingVoiceSeconds(db, learnerId, new Date())).toBe(293);

      await meter.stop();
      expect(await remainingVoiceSeconds(db, learnerId, new Date())).toBe(293);
    });
  });
});
