import "server-only";

import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { learnerProfiles } from "@/lib/db/schema";
import { recordVoiceSeconds } from "@/lib/voice-quota";
import { METER_INTERVAL_MS, nextMeterDelayMs, VoiceMeter } from "./job";

export type VoiceLimit = "quota" | "consent";

export async function hasVoiceConsent(db: Db, learnerId: string): Promise<boolean> {
  const [profile] = await db
    .select({ voiceConsentAt: learnerProfiles.voiceConsentAt })
    .from(learnerProfiles)
    .where(eq(learnerProfiles.learnerId, learnerId));

  return Boolean(profile && profile.voiceConsentAt !== null);
}

export async function meterTick(
  db: Db,
  learnerId: string,
  seconds: number,
  now: Date,
): Promise<{ remainingSeconds: number; limit: VoiceLimit | null }> {
  const remainingSeconds = await recordVoiceSeconds(db, learnerId, seconds, now);
  const consent = await hasVoiceConsent(db, learnerId);

  let limit: VoiceLimit | null = null;
  if (!consent) {
    limit = "consent";
  } else if (remainingSeconds <= 0) {
    limit = "quota";
  }

  return { remainingSeconds, limit };
}

export function startVoiceMeter(options: {
  db: Db;
  learnerId: string;
  remainingSeconds: number;
  onTick: (remainingSeconds: number) => void;
  onLimit: (limit: VoiceLimit) => void;
  clock?: () => number; // default Date.now
}): { stop: () => Promise<void> } {
  const clock = options.clock ?? Date.now;
  const meter = new VoiceMeter(clock());

  let timer: ReturnType<typeof setTimeout> | null = null;
  let runningTick: Promise<void> | null = null;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;

  function schedule(delayMs: number) {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      runTick();
    }, delayMs);
  }

  function runTick() {
    if (stopped) return;
    runningTick = (async () => {
      try {
        const seconds = meter.take(clock());
        const { remainingSeconds, limit } = await meterTick(
          options.db,
          options.learnerId,
          seconds,
          new Date(),
        );
        if (stopped) return;
        options.onTick(remainingSeconds);
        if (limit) {
          options.onLimit(limit);
          return;
        }
        schedule(nextMeterDelayMs(remainingSeconds));
      } catch (error) {
        console.error("Voice meter tick failed:", error);
        if (!stopped) {
          schedule(METER_INTERVAL_MS);
        }
      } finally {
        runningTick = null;
      }
    })();
  }

  schedule(nextMeterDelayMs(options.remainingSeconds));

  async function stop(): Promise<void> {
    if (stopPromise) {
      return stopPromise;
    }
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    stopPromise = (async () => {
      if (runningTick) {
        await runningTick;
      }
      const leftover = meter.take(clock());
      if (leftover > 0) {
        try {
          await recordVoiceSeconds(options.db, options.learnerId, leftover, new Date());
        } catch (error) {
          console.error("Failed to record final voice seconds:", error);
        }
      }
    })();
    return stopPromise;
  }

  return { stop };
}
