import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { fsrsCards, type FsrsCard } from "@/lib/db/schema";

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
