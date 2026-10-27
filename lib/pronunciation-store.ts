import "server-only";

import { and, count, eq, notInArray, sql } from "drizzle-orm";

import type { Db } from "@/lib/db";
import {
  learnerErrorPatterns,
  pronunciationScores,
  sessionFeedback,
  sessionTurns,
} from "@/lib/db/schema";
import { findPattern } from "@/lib/pronunciation-patterns";
import type { PatternFinding, PronunciationTip, ScoredTurn } from "@/lib/pronunciation-recap";
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

export async function countSessionScores(db: Db, sessionId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(pronunciationScores)
    .where(eq(pronunciationScores.sessionId, sessionId));
  return Number(row?.count ?? 0);
}

export async function loadSessionScores(
  db: Db,
  options: { learnerId: string; sessionId: string },
): Promise<ScoredTurn[]> {
  return db
    .select({
      audioMs: pronunciationScores.audioMs,
      accuracy: pronunciationScores.accuracy,
      fluency: pronunciationScores.fluency,
      prosody: pronunciationScores.prosody,
      weakWords: pronunciationScores.weakWords,
      mismatches: pronunciationScores.mismatches,
      transcript: sessionTurns.content,
    })
    .from(pronunciationScores)
    .innerJoin(sessionTurns, eq(pronunciationScores.turnId, sessionTurns.turnId))
    .where(
      and(
        eq(pronunciationScores.sessionId, options.sessionId),
        eq(pronunciationScores.learnerId, options.learnerId),
      ),
    )
    .orderBy(sessionTurns.position);
}

export async function markPronunciationPending(
  db: Db,
  options: { learnerId: string; sessionId: string },
): Promise<void> {
  await db
    .update(sessionFeedback)
    .set({
      pronunciationStatus: "pending",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessionFeedback.sessionId, options.sessionId),
        eq(sessionFeedback.learnerId, options.learnerId),
      ),
    );
}

export async function markPronunciationFailed(
  db: Db,
  options: { learnerId: string; sessionId: string },
): Promise<void> {
  await db
    .update(sessionFeedback)
    .set({
      pronunciationStatus: "failed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessionFeedback.sessionId, options.sessionId),
        eq(sessionFeedback.learnerId, options.learnerId),
      ),
    );
}

export async function clearPronunciationStatus(
  db: Db,
  options: { learnerId: string; sessionId: string },
): Promise<void> {
  await db
    .update(sessionFeedback)
    .set({
      pronunciationStatus: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessionFeedback.sessionId, options.sessionId),
        eq(sessionFeedback.learnerId, options.learnerId),
      ),
    );
}

export async function savePronunciationTips(
  db: Db,
  options: {
    learnerId: string;
    sessionId: string;
    tips: PronunciationTip[];
  },
): Promise<void> {
  await db
    .update(sessionFeedback)
    .set({
      pronunciationStatus: "done",
      pronunciationTips: options.tips,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessionFeedback.sessionId, options.sessionId),
        eq(sessionFeedback.learnerId, options.learnerId),
      ),
    );
}

export async function recordPronunciationPatterns(
  db: Db,
  options: {
    learnerId: string;
    patterns: PatternFinding[];
  },
): Promise<void> {
  const { learnerId, patterns } = options;

  await db.transaction(async (tx) => {
    for (const pattern of patterns) {
      const description = findPattern(pattern.code)?.tip ?? pattern.code;
      const lastExample = pattern.words[0] ?? null;
      const meanAccuracy = String(pattern.meanScore);

      await tx
        .insert(learnerErrorPatterns)
        .values({
          learnerId,
          modality: "PRONUNCIATION_IPA",
          errorCode: pattern.code,
          description,
          occurrenceCount: pattern.count,
          resolvedStreak: 0,
          lastExampleLearnerInput: lastExample,
          lastExampleMinimalCorrection: null,
          meanAcousticAccuracy: meanAccuracy,
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            learnerErrorPatterns.learnerId,
            learnerErrorPatterns.modality,
            learnerErrorPatterns.errorCode,
          ],
          set: {
            occurrenceCount: sql`${learnerErrorPatterns.occurrenceCount} + ${pattern.count}`,
            resolvedStreak: 0,
            description,
            lastExampleLearnerInput: lastExample,
            lastExampleMinimalCorrection: null,
            meanAcousticAccuracy: meanAccuracy,
            lastSeenAt: new Date(),
          },
        });
    }

    const seenCodes = patterns.map((p) => p.code);
    const whereClause =
      seenCodes.length > 0
        ? and(
            eq(learnerErrorPatterns.learnerId, learnerId),
            eq(learnerErrorPatterns.modality, "PRONUNCIATION_IPA"),
            notInArray(learnerErrorPatterns.errorCode, seenCodes),
          )
        : and(
            eq(learnerErrorPatterns.learnerId, learnerId),
            eq(learnerErrorPatterns.modality, "PRONUNCIATION_IPA"),
          );

    await tx
      .update(learnerErrorPatterns)
      .set({
        resolvedStreak: sql`${learnerErrorPatterns.resolvedStreak} + 1`,
      })
      .where(whereClause);
  });
}
