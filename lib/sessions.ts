import "server-only";

import { and, asc, eq, isNull, max } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { sessions, sessionTurns, type Session } from "@/lib/db/schema";
import type { ScenarioId } from "@/lib/scenarios";

// The client's session, only if it belongs to this learner, hasn't ended and (when given)
// is for the same scenario. So a client can never read or write someone else's session.
export async function findOpenSession(
  db: Db,
  options: { learnerId: string; sessionId: string; scenarioId?: ScenarioId },
): Promise<Session | null> {
  const [existing] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.sessionId, options.sessionId),
        eq(sessions.learnerId, options.learnerId),
        options.scenarioId ? eq(sessions.scenarioId, options.scenarioId) : undefined,
        isNull(sessions.endedAt),
      ),
    );
  return existing ?? null;
}

export async function startSession(
  db: Db,
  options: { learnerId: string; scenarioId: ScenarioId },
): Promise<Session> {
  const [created] = await db.insert(sessions).values(options).returning();
  return created!;
}

// The session's turns in order. Callers must check ownership with findOpenSession first.
export async function loadTurns(db: Db, sessionId: string) {
  return db
    .select({ id: sessionTurns.turnId, role: sessionTurns.role, content: sessionTurns.content })
    .from(sessionTurns)
    .where(eq(sessionTurns.sessionId, sessionId))
    .orderBy(asc(sessionTurns.position));
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
