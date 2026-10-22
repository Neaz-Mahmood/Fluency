import "server-only";

import { and, asc, count, desc, eq, inArray, isNull, max } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { sessions, sessionTurns, type Session } from "@/lib/db/schema";
import type { ScenarioId } from "@/lib/scenarios";

// The client's session, only if it belongs to this learner, hasn't ended and (when given)
// matches the scenario and mode. So a client can never read or write someone else's session.
export async function findOpenSession(
  db: Db,
  options: {
    learnerId: string;
    sessionId: string;
    scenarioId?: ScenarioId;
    mode?: "conversation" | "placement";
  },
): Promise<Session | null> {
  const [existing] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.sessionId, options.sessionId),
        eq(sessions.learnerId, options.learnerId),
        options.scenarioId ? eq(sessions.scenarioId, options.scenarioId) : undefined,
        options.mode ? eq(sessions.mode, options.mode) : undefined,
        isNull(sessions.endedAt),
      ),
    );
  return existing ?? null;
}

// The learner's session whether open or ended, preventing cross-learner access.
export async function findSession(
  db: Db,
  options: { learnerId: string; sessionId: string },
): Promise<Session | null> {
  const [existing] = await db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.sessionId, options.sessionId), eq(sessions.learnerId, options.learnerId)),
    );
  return existing ?? null;
}

export const HISTORY_LIMIT = 50;

// The learner's sessions, newest first, with their turn counts.
export async function listSessions(db: Db, learnerId: string) {
  return db
    .select({
      sessionId: sessions.sessionId,
      mode: sessions.mode,
      scenarioId: sessions.scenarioId,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      turnCount: count(sessionTurns.turnId),
    })
    .from(sessions)
    .leftJoin(sessionTurns, eq(sessionTurns.sessionId, sessions.sessionId))
    .where(eq(sessions.learnerId, learnerId))
    .groupBy(sessions.sessionId)
    .orderBy(desc(sessions.startedAt))
    .limit(HISTORY_LIMIT);
}

export async function startSession(
  db: Db,
  options: {
    learnerId: string;
    mode: "conversation" | "placement" | "writing";
    scenarioId: ScenarioId | null;
  },
): Promise<Session> {
  const [created] = await db.insert(sessions).values(options).returning();
  return created!;
}

// A writing session's single turn: the learner's text, typed.
export async function saveWritingTurn(
  db: Db,
  options: { sessionId: string; content: string },
): Promise<void> {
  await db.insert(sessionTurns).values({
    sessionId: options.sessionId,
    position: 0,
    role: "user",
    content: options.content,
    inputMode: "typed",
  });
}

// Ends the learner's open session, returning null if already ended or not found.
export async function endSession(
  db: Db,
  options: { learnerId: string; sessionId: string },
): Promise<Session | null> {
  const [updated] = await db
    .update(sessions)
    .set({ endedAt: new Date() })
    .where(
      and(
        eq(sessions.sessionId, options.sessionId),
        eq(sessions.learnerId, options.learnerId),
        isNull(sessions.endedAt),
      ),
    )
    .returning();
  return updated ?? null;
}

// The session's turns in order. Callers must check ownership with findOpenSession first.
export async function loadTurns(db: Db, sessionId: string) {
  return db
    .select({
      id: sessionTurns.turnId,
      role: sessionTurns.role,
      content: sessionTurns.content,
      inputMode: sessionTurns.inputMode,
    })
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
    replyTurnId: string;
    firstTokenMs: number;
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
              turnId: exchange.replyTurnId,
              sessionId: exchange.sessionId,
              position: next + 1,
              role: "assistant" as const,
              content: reply,
              firstTokenMs: exchange.firstTokenMs,
            },
          ]
        : []),
    ]);
  });
}

// Records the client-measured time to speech start for an assistant turn, only if the
// session belongs to the current learner.
export async function recordFirstAudio(
  db: Db,
  options: { learnerId: string; turnId: string; firstAudioMs: number },
): Promise<boolean> {
  const updated = await db
    .update(sessionTurns)
    .set({ firstAudioMs: options.firstAudioMs })
    .where(
      and(
        eq(sessionTurns.turnId, options.turnId),
        eq(sessionTurns.role, "assistant"),
        inArray(
          sessionTurns.sessionId,
          db
            .select({ id: sessions.sessionId })
            .from(sessions)
            .where(eq(sessions.learnerId, options.learnerId)),
        ),
      ),
    )
    .returning({ turnId: sessionTurns.turnId });
  return updated.length > 0;
}
