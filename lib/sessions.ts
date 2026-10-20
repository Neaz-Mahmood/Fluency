import "server-only";

import { and, eq, isNull, max } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { sessions, sessionTurns, type Session } from "@/lib/db/schema";
import type { ScenarioId } from "@/lib/scenarios";

// The session to save this turn into. Reuses the client's session only if it belongs to
// this learner, is for the same scenario and hasn't ended; otherwise starts a new one.
// So a client can never write into someone else's session.
export async function resolveSession(
  db: Db,
  options: { learnerId: string; scenarioId: ScenarioId; sessionId?: string },
): Promise<Session> {
  if (options.sessionId) {
    const [existing] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.sessionId, options.sessionId),
          eq(sessions.learnerId, options.learnerId),
          eq(sessions.scenarioId, options.scenarioId),
          isNull(sessions.endedAt),
        ),
      );
    if (existing) return existing;
  }

  const [created] = await db
    .insert(sessions)
    .values({ learnerId: options.learnerId, scenarioId: options.scenarioId })
    .returning();
  return created!;
}

// Appends the learner's turn and the partner's reply. An empty reply (the provider failed
// before any text) saves only the learner's turn. Locks the session row so concurrent
// requests can't take the same position.
export async function saveExchange(
  db: Db,
  exchange: {
    sessionId: string;
    userText: string;
    inputMode: "voice" | "typed" | null;
    replyText: string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .select({ sessionId: sessions.sessionId })
      .from(sessions)
      .where(eq(sessions.sessionId, exchange.sessionId))
      .for("update");

    const [last] = await tx
      .select({ position: max(sessionTurns.position) })
      .from(sessionTurns)
      .where(eq(sessionTurns.sessionId, exchange.sessionId));
    const next = (last?.position ?? -1) + 1;

    const reply = exchange.replyText.trim();
    await tx.insert(sessionTurns).values([
      {
        sessionId: exchange.sessionId,
        position: next,
        role: "user",
        content: exchange.userText,
        inputMode: exchange.inputMode,
      },
      ...(reply
        ? [
            {
              sessionId: exchange.sessionId,
              position: next + 1,
              role: "assistant" as const,
              content: reply,
            },
          ]
        : []),
    ]);
  });
}
