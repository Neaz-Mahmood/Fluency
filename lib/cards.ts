import "server-only";

import { and, asc, count, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { fsrsCards, fsrsReviewLogs, type FsrsCard } from "@/lib/db/schema";
import type { AnswerMode, CardSchedule, ReviewLogFields } from "@/lib/fsrs";

export async function saveCard(
  db: Db,
  options: {
    learnerId: string;
    cardType: FsrsCard["cardType"];
    targetItem: string;
    nativeTranslation: string;
    sourceContextSentence?: string | null;
  },
): Promise<{ card: FsrsCard; created: boolean }> {
  const [created] = await db
    .insert(fsrsCards)
    .values({
      learnerId: options.learnerId,
      cardType: options.cardType,
      targetItem: options.targetItem,
      nativeTranslation: options.nativeTranslation,
      sourceContextSentence: options.sourceContextSentence,
    })
    .onConflictDoNothing({
      target: [fsrsCards.learnerId, fsrsCards.cardType, fsrsCards.targetItem],
    })
    .returning();

  if (created) {
    return { card: created, created: true };
  }

  const [existing] = await db
    .select()
    .from(fsrsCards)
    .where(
      and(
        eq(fsrsCards.learnerId, options.learnerId),
        eq(fsrsCards.cardType, options.cardType),
        eq(fsrsCards.targetItem, options.targetItem),
      ),
    );

  return { card: existing!, created: false };
}

export async function savedTargetItems(
  db: Db,
  learnerId: string,
  targetItems: string[],
): Promise<Set<string>> {
  if (targetItems.length === 0) {
    return new Set<string>();
  }

  const rows = await db
    .select({ targetItem: fsrsCards.targetItem })
    .from(fsrsCards)
    .where(and(eq(fsrsCards.learnerId, learnerId), inArray(fsrsCards.targetItem, targetItems)));

  return new Set(rows.map((row) => row.targetItem));
}

export async function nextDueCard(db: Db, learnerId: string, now: Date): Promise<FsrsCard | null> {
  const [card] = await db
    .select()
    .from(fsrsCards)
    .where(and(eq(fsrsCards.learnerId, learnerId), lte(fsrsCards.due, now)))
    .orderBy(asc(fsrsCards.due))
    .limit(1);

  return card ?? null;
}

export async function countDueCards(db: Db, learnerId: string, now: Date): Promise<number> {
  const [result] = await db
    .select({ total: count() })
    .from(fsrsCards)
    .where(and(eq(fsrsCards.learnerId, learnerId), lte(fsrsCards.due, now)));

  return result?.total ?? 0;
}

export async function getCard(
  db: Db,
  options: { learnerId: string; cardId: string },
): Promise<FsrsCard | null> {
  const [card] = await db
    .select()
    .from(fsrsCards)
    .where(and(eq(fsrsCards.cardId, options.cardId), eq(fsrsCards.learnerId, options.learnerId)));

  return card ?? null;
}

export async function recordReview(
  db: Db,
  options: {
    learnerId: string;
    cardId: string;
    schedule: CardSchedule;
    log: ReviewLogFields & {
      answerMode: AnswerMode;
      responseLatencyMs: number;
      generatedReviewSentence: string | null;
    };
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(fsrsCards)
      .set({
        state: options.schedule.state,
        due: options.schedule.due,
        stability: options.schedule.stability,
        difficulty: options.schedule.difficulty,
        elapsedDays: options.schedule.elapsedDays,
        scheduledDays: options.schedule.scheduledDays,
        learningSteps: options.schedule.learningSteps,
        reps: options.schedule.reps,
        lapses: options.schedule.lapses,
        lastReview: options.schedule.lastReview,
      })
      .where(and(eq(fsrsCards.cardId, options.cardId), eq(fsrsCards.learnerId, options.learnerId)))
      .returning();

    if (!updated) {
      throw new Error("Card not found.");
    }

    await tx.insert(fsrsReviewLogs).values({
      cardId: options.cardId,
      learnerId: options.learnerId,
      ...options.log,
    });
  });
}

export async function recentLatencies(
  db: Db,
  learnerId: string,
  mode: AnswerMode,
  limit = 100,
): Promise<number[]> {
  const rows = await db
    .select({ latency: fsrsReviewLogs.responseLatencyMs })
    .from(fsrsReviewLogs)
    .where(
      and(
        eq(fsrsReviewLogs.learnerId, learnerId),
        eq(fsrsReviewLogs.answerMode, mode),
        gte(fsrsReviewLogs.rating, 2),
        isNotNull(fsrsReviewLogs.responseLatencyMs),
      ),
    )
    .orderBy(desc(fsrsReviewLogs.reviewedAt))
    .limit(limit);

  return rows.map((r) => r.latency).filter((l): l is number => l !== null);
}
