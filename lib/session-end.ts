import "server-only";

import type { Db } from "@/lib/db";
import type { LearnerProfile } from "@/lib/db/schema";
import { runFeedback } from "@/lib/feedback-job";
import { markFeedbackPending } from "@/lib/feedback-store";
import { runPronunciationFeedback } from "@/lib/pronunciation-job";
import { markPronunciationPending } from "@/lib/pronunciation-store";
import { endSession, loadTurns } from "@/lib/sessions";
import { runSummary } from "@/lib/summary-job";

// Ends an open conversation session and marks its jobs pending. Returns null if the session was
// already ended (someone else got there first) or isn't the learner's.
export async function finishConversation(
  db: Db,
  learner: Pick<LearnerProfile, "learnerId">,
  sessionId: string,
): Promise<{ spoken: boolean } | null> {
  const ended = await endSession(db, { learnerId: learner.learnerId, sessionId });
  if (!ended) {
    return null;
  }

  await markFeedbackPending(db, { learnerId: learner.learnerId, sessionId });

  const turns = await loadTurns(db, sessionId);
  const spoken = turns.some((turn) => turn.role === "user" && turn.inputMode === "voice");
  if (spoken) {
    await markPronunciationPending(db, { learnerId: learner.learnerId, sessionId });
  }

  return { spoken };
}

// The jobs that run once a conversation ends. Each one catches and logs its own errors.
export async function runConversationJobs(
  learner: LearnerProfile,
  sessionId: string,
  options: { spoken: boolean },
): Promise<void> {
  await Promise.allSettled([
    runSummary(learner, sessionId),
    runFeedback(learner, sessionId, "conversation"),
    ...(options.spoken ? [runPronunciationFeedback(learner, sessionId)] : []),
  ]);
}
