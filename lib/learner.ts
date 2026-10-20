import "server-only";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb, type Db } from "@/lib/db";
import { learnerProfiles, type LearnerProfile } from "@/lib/db/schema";
import { LEARNER_COOKIE, isLearnerId } from "@/lib/learner-id";

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

// The current learner. Every route gets the learner from here, never from the request
// body. Phase 5 login changes only this function: it will read the session instead.
export async function getLearner(): Promise<LearnerProfile> {
  const learnerId = (await cookies()).get(LEARNER_COOKIE)?.value;
  if (!isLearnerId(learnerId)) {
    throw new LearnerUnavailableError("No learner cookie on this request.");
  }
  return ensureLearnerProfile(getDb(), learnerId);
}
