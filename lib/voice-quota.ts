import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { voiceUsage } from "@/lib/db/schema";

// doc/roadmap.md Phase 4 default; the user chose 5 minutes a day (2026-10-22).
export const VOICE_SECONDS_PER_DAY = 300;
// Fluency's first learners are in Bangladesh, so the daily quota resets at Dhaka midnight.
export const QUOTA_TIME_ZONE = "Asia/Dhaka";

const quotaDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: QUOTA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function quotaDay(now: Date): string {
  return quotaDayFormatter.format(now);
}

export async function remainingVoiceSeconds(db: Db, learnerId: string, now: Date): Promise<number> {
  const day = quotaDay(now);
  const [row] = await db
    .select({ secondsUsed: voiceUsage.secondsUsed })
    .from(voiceUsage)
    .where(and(eq(voiceUsage.learnerId, learnerId), eq(voiceUsage.day, day)));

  if (!row) {
    return VOICE_SECONDS_PER_DAY;
  }

  return Math.max(0, VOICE_SECONDS_PER_DAY - row.secondsUsed);
}

export async function recordVoiceSeconds(
  db: Db,
  learnerId: string,
  seconds: number,
  now: Date,
): Promise<number> {
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new Error("Voice seconds must be a non-negative integer.");
  }

  const day = quotaDay(now);
  const [row] = await db
    .insert(voiceUsage)
    .values({
      learnerId,
      day,
      secondsUsed: seconds,
    })
    .onConflictDoUpdate({
      target: [voiceUsage.learnerId, voiceUsage.day],
      set: {
        secondsUsed: sql`${voiceUsage.secondsUsed} + ${seconds}`,
      },
    })
    .returning();

  if (!row) {
    throw new Error("Failed to record voice seconds.");
  }

  return Math.max(0, VOICE_SECONDS_PER_DAY - row.secondsUsed);
}
