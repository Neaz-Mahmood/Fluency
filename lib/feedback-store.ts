import "server-only";

import { and, desc, eq, isNotNull, lt, notInArray, sql } from "drizzle-orm";

import type { Db } from "@/lib/db";
import {
  learnerErrorPatterns,
  sessionFeedback,
  type SessionFeedback,
  type StoredFeedbackItem,
} from "@/lib/db/schema";
import type { VocabularyItem } from "@/lib/feedback";

export async function markFeedbackPending(
  db: Db,
  options: { learnerId: string; sessionId: string },
): Promise<void> {
  await db
    .insert(sessionFeedback)
    .values({
      sessionId: options.sessionId,
      learnerId: options.learnerId,
      status: "pending",
    })
    .onConflictDoNothing();
}

// markFeedbackPending must run first.
export async function saveFeedback(
  db: Db,
  options: {
    learnerId: string;
    sessionId: string;
    items: StoredFeedbackItem[];
    vocabulary: VocabularyItem[];
  },
): Promise<void> {
  await db
    .update(sessionFeedback)
    .set({
      status: "done",
      items: options.items,
      vocabulary: options.vocabulary,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessionFeedback.sessionId, options.sessionId),
        eq(sessionFeedback.learnerId, options.learnerId),
      ),
    );
}

export async function markFeedbackFailed(
  db: Db,
  options: { learnerId: string; sessionId: string },
): Promise<void> {
  await db
    .update(sessionFeedback)
    .set({
      status: "failed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessionFeedback.sessionId, options.sessionId),
        eq(sessionFeedback.learnerId, options.learnerId),
      ),
    );
}

export async function getFeedback(
  db: Db,
  options: { learnerId: string; sessionId: string },
): Promise<SessionFeedback | null> {
  const [row] = await db
    .select()
    .from(sessionFeedback)
    .where(
      and(
        eq(sessionFeedback.sessionId, options.sessionId),
        eq(sessionFeedback.learnerId, options.learnerId),
      ),
    );
  return row ?? null;
}

export async function recordErrorPatterns(
  db: Db,
  options: {
    learnerId: string;
    items: StoredFeedbackItem[];
    modalities: ("SPEAKING_GRAMMAR" | "WRITING_GRAMMAR")[];
  },
): Promise<void> {
  const { learnerId, items, modalities } = options;

  await db.transaction(async (tx) => {
    // Each edit of each item counts once toward (modality, edit.code), with
    // modality = item.inputMode === "voice" ? "SPEAKING_GRAMMAR" : "WRITING_GRAMMAR".
    // For each key, keep the session's count and its last item (for the examples).
    const patternsByKey = new Map<
      string,
      {
        modality: "SPEAKING_GRAMMAR" | "WRITING_GRAMMAR";
        errorCode: string;
        count: number;
        lastItem: StoredFeedbackItem;
      }
    >();

    for (const item of items) {
      const modality: "SPEAKING_GRAMMAR" | "WRITING_GRAMMAR" =
        item.inputMode === "voice" ? "SPEAKING_GRAMMAR" : "WRITING_GRAMMAR";
      for (const edit of item.edits) {
        const key = `${modality}:${edit.code}`;
        const existing = patternsByKey.get(key);
        if (existing) {
          existing.count += 1;
          existing.lastItem = item;
        } else {
          patternsByKey.set(key, {
            modality,
            errorCode: edit.code,
            count: 1,
            lastItem: item,
          });
        }
      }
    }

    for (const entry of patternsByKey.values()) {
      await tx
        .insert(learnerErrorPatterns)
        .values({
          learnerId,
          modality: entry.modality,
          errorCode: entry.errorCode,
          description: entry.lastItem.explanation,
          occurrenceCount: entry.count,
          resolvedStreak: 0,
          lastExampleLearnerInput: entry.lastItem.original,
          lastExampleMinimalCorrection: entry.lastItem.minimalCorrection,
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            learnerErrorPatterns.learnerId,
            learnerErrorPatterns.modality,
            learnerErrorPatterns.errorCode,
          ],
          set: {
            occurrenceCount: sql`${learnerErrorPatterns.occurrenceCount} + ${entry.count}`,
            resolvedStreak: 0,
            description: entry.lastItem.explanation,
            lastExampleLearnerInput: entry.lastItem.original,
            lastExampleMinimalCorrection: entry.lastItem.minimalCorrection,
            lastSeenAt: new Date(),
          },
        });
    }

    const seenCodesByModality = new Map<"SPEAKING_GRAMMAR" | "WRITING_GRAMMAR", Set<string>>();
    for (const entry of patternsByKey.values()) {
      let set = seenCodesByModality.get(entry.modality);
      if (!set) {
        set = new Set();
        seenCodesByModality.set(entry.modality, set);
      }
      set.add(entry.errorCode);
    }

    // A pattern resolves a step each session that used its modality without repeating it.
    const uniqueModalities = Array.from(new Set(modalities));
    for (const modality of uniqueModalities) {
      const seenCodes = Array.from(seenCodesByModality.get(modality) ?? []);
      const whereClause =
        seenCodes.length > 0
          ? and(
              eq(learnerErrorPatterns.learnerId, learnerId),
              eq(learnerErrorPatterns.modality, modality),
              notInArray(learnerErrorPatterns.errorCode, seenCodes),
            )
          : and(
              eq(learnerErrorPatterns.learnerId, learnerId),
              eq(learnerErrorPatterns.modality, modality),
            );

      await tx
        .update(learnerErrorPatterns)
        .set({
          resolvedStreak: sql`${learnerErrorPatterns.resolvedStreak} + 1`,
        })
        .where(whereClause);
    }
  });
}

// A pattern counts as resolved after this many sessions in its modality without it.
export const RESOLVED_AFTER_SESSIONS = 3;

export async function activeErrorExamples(
  db: Db,
  learnerId: string,
  limit: number,
): Promise<{ said: string; correct: string }[]> {
  if (limit <= 0) {
    return [];
  }

  const rows = await db
    .select({
      said: learnerErrorPatterns.lastExampleLearnerInput,
      correct: learnerErrorPatterns.lastExampleMinimalCorrection,
    })
    .from(learnerErrorPatterns)
    .where(
      and(
        eq(learnerErrorPatterns.learnerId, learnerId),
        lt(learnerErrorPatterns.resolvedStreak, RESOLVED_AFTER_SESSIONS),
        isNotNull(learnerErrorPatterns.lastExampleLearnerInput),
        isNotNull(learnerErrorPatterns.lastExampleMinimalCorrection),
      ),
    )
    .orderBy(desc(learnerErrorPatterns.occurrenceCount), desc(learnerErrorPatterns.lastSeenAt))
    .limit(limit);

  return rows.map((row) => ({
    said: row.said!,
    correct: row.correct!,
  }));
}
