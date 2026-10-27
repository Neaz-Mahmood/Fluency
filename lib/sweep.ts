import "server-only";

import { timingSafeEqual } from "node:crypto";
import { inArray, sql } from "drizzle-orm";

import { getDb, type Db } from "@/lib/db";
import { learnerProfiles, sessions, type LearnerProfile } from "@/lib/db/schema";
import { runFeedback } from "@/lib/feedback-job";
import { runPronunciationFeedback } from "@/lib/pronunciation-job";
import { finishConversation, runConversationJobs } from "@/lib/session-end";

export const IDLE_SESSION_MS = 30 * 60_000; // a conversation with no turn for this long is over
export const STALE_JOB_MS = 5 * 60_000; // a pending job not touched for this long is retried
export const MAX_JOB_ATTEMPTS = 3;

type Scope = { now: Date; learnerId?: string };

export async function findIdleSessions(
  db: Db,
  scope: Scope & { exceptSessionId?: string; limit: number },
): Promise<{ sessionId: string; learnerId: string }[]> {
  const cutoffIso = new Date(scope.now.getTime() - IDLE_SESSION_MS).toISOString();

  const result = await db.execute(sql`
    SELECT s.session_id, s.learner_id
    FROM sessions s
    JOIN session_turns t ON s.session_id = t.session_id
    WHERE s.mode = 'conversation'
      AND s.ended_at IS NULL
      ${scope.learnerId ? sql`AND s.learner_id = ${scope.learnerId}` : sql``}
      ${scope.exceptSessionId ? sql`AND s.session_id <> ${scope.exceptSessionId}` : sql``}
    GROUP BY s.session_id, s.learner_id
    HAVING count(CASE WHEN t.role = 'user' THEN 1 END) > 0
       AND max(t.created_at) < ${cutoffIso}::timestamptz
    ORDER BY max(t.created_at) ASC
    LIMIT ${scope.limit}
  `);

  return (result as unknown as { session_id: string; learner_id: string }[]).map((row) => ({
    sessionId: row.session_id,
    learnerId: row.learner_id,
  }));
}

export async function claimStaleJobs(
  db: Db,
  scope: Scope & { limit: number },
): Promise<
  {
    sessionId: string;
    learnerId: string;
    feedbackPending: boolean;
    pronunciationPending: boolean;
  }[]
> {
  const nowIso = scope.now.toISOString();
  const staleIso = new Date(scope.now.getTime() - STALE_JOB_MS).toISOString();

  const result = await db.execute(sql`
    UPDATE session_feedback SET attempts = attempts + 1, updated_at = ${nowIso}::timestamptz
    WHERE session_id IN (
      SELECT session_id FROM session_feedback
      WHERE (status = 'pending' OR pronunciation_status = 'pending')
        AND updated_at < ${staleIso}::timestamptz
        AND attempts < ${MAX_JOB_ATTEMPTS}
        ${scope.learnerId ? sql`AND learner_id = ${scope.learnerId}` : sql``}
      ORDER BY updated_at
      LIMIT ${scope.limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING session_id, learner_id, status, pronunciation_status
  `);

  return (
    result as unknown as {
      session_id: string;
      learner_id: string;
      status: string;
      pronunciation_status: string | null;
    }[]
  ).map((row) => ({
    sessionId: row.session_id,
    learnerId: row.learner_id,
    feedbackPending: row.status === "pending",
    pronunciationPending: row.pronunciation_status === "pending",
  }));
}

export async function failExhaustedJobs(db: Db, scope: Scope): Promise<number> {
  const nowIso = scope.now.toISOString();
  const staleIso = new Date(scope.now.getTime() - STALE_JOB_MS).toISOString();

  const result = await db.execute(sql`
    UPDATE session_feedback
    SET status = CASE WHEN status = 'pending' THEN 'failed'::feedback_status ELSE status END,
        pronunciation_status = CASE WHEN pronunciation_status = 'pending' THEN 'failed'::feedback_status ELSE pronunciation_status END,
        updated_at = ${nowIso}::timestamptz
    WHERE attempts >= ${MAX_JOB_ATTEMPTS}
      AND updated_at < ${staleIso}::timestamptz
      AND (status = 'pending' OR pronunciation_status = 'pending')
      ${scope.learnerId ? sql`AND learner_id = ${scope.learnerId}` : sql``}
    RETURNING session_id
  `);

  return (result as unknown as unknown[]).length;
}

export type SweepJobs = {
  runConversationJobs: typeof runConversationJobs;
  runFeedback: typeof runFeedback;
  runPronunciationFeedback: typeof runPronunciationFeedback;
};

export async function sweep(
  options: {
    learnerId?: string;
    exceptSessionId?: string;
    limit?: number;
    now?: Date;
    db?: Db;
  } = {},
  jobs: SweepJobs = { runConversationJobs, runFeedback, runPronunciationFeedback },
): Promise<{ ended: number; retried: number; failed: number }> {
  let ended = 0;
  let retried = 0;
  let failed = 0;

  try {
    const db = options.db ?? getDb();
    const limit = options.limit ?? 10;
    const now = options.now ?? new Date();
    const { learnerId, exceptSessionId } = options;

    // Retries and give-ups come before ending idle sessions, so the jobs this sweep starts for a
    // session it ends are never claimed again by the same sweep.
    const claimed = await claimStaleJobs(db, {
      now,
      learnerId,
      limit,
    });
    retried = claimed.length;

    let sessionModes = new Map<string, "conversation" | "placement" | "writing">();
    if (claimed.length > 0) {
      const claimedSessionIds = claimed.map((c) => c.sessionId);
      const sessionRows = await db
        .select({ sessionId: sessions.sessionId, mode: sessions.mode })
        .from(sessions)
        .where(inArray(sessions.sessionId, claimedSessionIds));
      sessionModes = new Map(sessionRows.map((s) => [s.sessionId, s.mode]));
    }

    failed = await failExhaustedJobs(db, { now, learnerId });

    const idleSessions = await findIdleSessions(db, {
      now,
      learnerId,
      exceptSessionId,
      limit,
    });

    const endedSessions: {
      sessionId: string;
      learnerId: string;
      finished: { spoken: boolean };
    }[] = [];

    for (const idle of idleSessions) {
      const finished = await finishConversation(db, { learnerId: idle.learnerId }, idle.sessionId);
      if (finished) {
        ended += 1;
        endedSessions.push({
          sessionId: idle.sessionId,
          learnerId: idle.learnerId,
          finished,
        });
      }
    }

    const neededLearnerIds = Array.from(
      new Set([...endedSessions.map((s) => s.learnerId), ...claimed.map((c) => c.learnerId)]),
    );

    let profileById = new Map<string, LearnerProfile>();
    if (neededLearnerIds.length > 0) {
      const profiles = await db
        .select()
        .from(learnerProfiles)
        .where(inArray(learnerProfiles.learnerId, neededLearnerIds));
      profileById = new Map(profiles.map((p) => [p.learnerId, p]));
    }

    const jobPromises: Promise<unknown>[] = [];

    for (const item of endedSessions) {
      const learner = profileById.get(item.learnerId);
      if (!learner) continue;
      jobPromises.push(jobs.runConversationJobs(learner, item.sessionId, item.finished));
    }

    for (const row of claimed) {
      const learner = profileById.get(row.learnerId);
      if (!learner) continue;
      const sessionMode = sessionModes.get(row.sessionId);
      const mode = sessionMode === "writing" ? "writing" : "conversation";
      if (row.feedbackPending) {
        jobPromises.push(jobs.runFeedback(learner, row.sessionId, mode));
      }
      if (row.pronunciationPending) {
        jobPromises.push(jobs.runPronunciationFeedback(learner, row.sessionId));
      }
    }

    await Promise.allSettled(jobPromises);

    if (ended > 0 || retried > 0 || failed > 0) {
      console.log(`[sweep] ended ${ended}, retried ${retried}, failed ${failed}`);
    }

    return { ended, retried, failed };
  } catch (error) {
    console.error("Sweep failed.", error);
    return { ended, retried, failed };
  }
}

export function cronAuthorization(
  header: string | null,
  secret: string | undefined,
): "ok" | "unauthorized" | "disabled" {
  if (!secret) {
    return "disabled";
  }
  if (!header) {
    return "unauthorized";
  }
  const expected = `Bearer ${secret}`;
  const headerBuffer = Buffer.from(header);
  const expectedBuffer = Buffer.from(expected);
  if (headerBuffer.length !== expectedBuffer.length) {
    return "unauthorized";
  }
  if (!timingSafeEqual(headerBuffer, expectedBuffer)) {
    return "unauthorized";
  }
  return "ok";
}
