import "server-only";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb, type Db } from "@/lib/db";
import { learnerProfiles, type LearnerProfile } from "@/lib/db/schema";
import { TARGET_LANGUAGE, type NativeLanguage } from "@/lib/languages";
import { LEARNER_COOKIE, isLearnerId } from "@/lib/learner-id";
import type { CefrLevel } from "@/lib/placement";

export class LearnerUnavailableError extends Error {}

// Creates the learner row on first use. ON CONFLICT DO NOTHING keeps concurrent
// first requests from creating duplicates.
export async function ensureLearnerProfile(db: Db, learnerId: string): Promise<LearnerProfile> {
  await db.insert(learnerProfiles).values({ learnerId }).onConflictDoNothing();
  const [profile] = await db
    .select()
    .from(learnerProfiles)
    .where(eq(learnerProfiles.learnerId, learnerId));
  if (!profile) {
    throw new LearnerUnavailableError(`Learner ${learnerId} could not be created.`);
  }
  return profile;
}

// Deletes the learner and, through ON DELETE CASCADE, every row that belongs to them.
// Returns false if there was no such learner.
export async function deleteLearner(db: Db, learnerId: string): Promise<boolean> {
  const deleted = await db
    .delete(learnerProfiles)
    .where(eq(learnerProfiles.learnerId, learnerId))
    .returning({ learnerId: learnerProfiles.learnerId });
  return deleted.length > 0;
}

// The current learner. Every route gets the learner from here, never from the request
// body. Phase 5 login changes only these functions: they will read the session instead.
export async function getLearner(): Promise<LearnerProfile> {
  const learnerId = (await cookies()).get(LEARNER_COOKIE)?.value;
  if (!isLearnerId(learnerId)) {
    throw new LearnerUnavailableError("No learner cookie on this request.");
  }
  return ensureLearnerProfile(getDb(), learnerId);
}

// "Delete my data": removes the current learner's data and forgets the cookie. The next
// request gets a fresh learner id from proxy.ts. Only Server Functions and Route Handlers
// may call this, because it deletes a cookie.
export async function deleteCurrentLearner(): Promise<void> {
  const store = await cookies();
  const learnerId = store.get(LEARNER_COOKIE)?.value;
  if (isLearnerId(learnerId)) {
    await deleteLearner(getDb(), learnerId);
  }
  store.delete(LEARNER_COOKIE);
}

// Sets the learner's native language and pins the target language to English.
export async function setNativeLanguage(
  db: Db,
  learnerId: string,
  nativeLanguage: NativeLanguage,
): Promise<void> {
  await db
    .update(learnerProfiles)
    .set({
      nativeLanguage,
      targetLanguage: TARGET_LANGUAGE,
    })
    .where(eq(learnerProfiles.learnerId, learnerId));
}

// Sets provisional CEFR levels; listening and reading start at the speaking level.
export async function setPlacementLevels(
  db: Db,
  learnerId: string,
  levels: { speaking: CefrLevel; writing: CefrLevel },
): Promise<void> {
  await db
    .update(learnerProfiles)
    .set({
      cefrSpeaking: levels.speaking,
      cefrWriting: levels.writing,
      cefrListening: levels.speaking,
      cefrReading: levels.speaking,
    })
    .where(eq(learnerProfiles.learnerId, learnerId));
}

// Stores the tutor's compact private note built after a conversation session.
export async function setTutorSummary(db: Db, learnerId: string, summary: string): Promise<void> {
  await db
    .update(learnerProfiles)
    .set({ compactTutorSummary: summary })
    .where(eq(learnerProfiles.learnerId, learnerId));
}
