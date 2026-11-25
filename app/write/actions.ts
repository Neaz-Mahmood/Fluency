"use server";

import { after } from "next/server";

import { MAX_CHARS } from "@/lib/chat-request";
import { getDb } from "@/lib/db";
import { runFeedback } from "@/lib/feedback-job";
import { markFeedbackPending } from "@/lib/feedback-store";
import { getLearner } from "@/lib/learner";
import { endSession, saveWritingTurn, startSession } from "@/lib/sessions";

export async function submitWriting(
  text: unknown,
): Promise<
  { status: "ok"; sessionId: string } | { status: "error"; reason: "empty" | "too-long" | "failed" }
> {
  if (typeof text !== "string") {
    return { status: "error", reason: "empty" };
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return { status: "error", reason: "empty" };
  }
  if (trimmed.length > MAX_CHARS) {
    return { status: "error", reason: "too-long" };
  }

  try {
    const learner = await getLearner();
    const db = getDb();
    const session = await startSession(db, {
      learnerId: learner.learnerId,
      mode: "writing",
      scenarioId: null,
    });
    await saveWritingTurn(db, {
      sessionId: session.sessionId,
      content: trimmed,
    });
    await endSession(db, {
      learnerId: learner.learnerId,
      sessionId: session.sessionId,
    });
    await markFeedbackPending(db, {
      learnerId: learner.learnerId,
      sessionId: session.sessionId,
    });
    after(() => runFeedback(learner, session.sessionId, "writing"));
    return { status: "ok", sessionId: session.sessionId };
  } catch (error) {
    console.error("Could not start the writing review.", error);
    return { status: "error", reason: "failed" };
  }
}
