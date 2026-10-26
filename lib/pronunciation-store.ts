import "server-only";

import type { Db } from "@/lib/db";
import { pronunciationScores } from "@/lib/db/schema";
import type { PronunciationScores } from "@/lib/pronunciation-score";

export async function savePronunciationScore(
  db: Db,
  row: {
    turnId: string;
    sessionId: string;
    learnerId: string;
    audioMs: number;
  } & PronunciationScores,
): Promise<void> {
  await db.insert(pronunciationScores).values(row);
}
