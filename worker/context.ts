import "server-only";

import { eq } from "drizzle-orm";

import { dueCardItems } from "@/lib/cards";
import type { Db } from "@/lib/db";
import { learnerProfiles } from "@/lib/db/schema";
import { activeErrorExamples } from "@/lib/feedback-store";
import { getSystemPrompt } from "@/lib/prompts";
import { findOpenSession, loadTurns } from "@/lib/sessions";
import { remainingVoiceSeconds } from "@/lib/voice-quota";
import { ttsSpeedForLevel, type VoiceJob } from "./job";

export type VoiceContext = {
  instructions: string;
  sessionId: string | null;
  history: { role: "user" | "assistant"; content: string }[];
  remainingSeconds: number;
  ttsSpeed: number;
};

export async function loadVoiceContext(
  db: Db,
  job: VoiceJob,
  now: Date,
): Promise<VoiceContext | { error: string }> {
  const [profile] = await db
    .select()
    .from(learnerProfiles)
    .where(eq(learnerProfiles.learnerId, job.learnerId));

  if (!profile) {
    return { error: "Learner not found." };
  }

  if (profile.voiceConsentAt === null) {
    return { error: "No voice consent." };
  }

  const remainingSeconds = await remainingVoiceSeconds(db, job.learnerId, now);
  if (remainingSeconds <= 0) {
    return { error: "No voice time left today." };
  }

  const [items, mistakes] = await Promise.all([
    dueCardItems(db, job.learnerId, now, 2),
    activeErrorExamples(db, job.learnerId, 2),
  ]);

  const instructions = getSystemPrompt(job.scenarioId, profile, { items, mistakes });

  let sessionId: string | null = null;
  let history: { role: "user" | "assistant"; content: string }[] = [];

  if (job.sessionId) {
    const openSession = await findOpenSession(db, {
      learnerId: job.learnerId,
      sessionId: job.sessionId,
      scenarioId: job.scenarioId,
      mode: "conversation",
    });

    if (!openSession) {
      return { error: "Session not found." };
    }

    const turns = await loadTurns(db, openSession.sessionId);
    sessionId = openSession.sessionId;
    history = turns.map((turn) => ({ role: turn.role, content: turn.content }));
  }

  const ttsSpeed = ttsSpeedForLevel(profile.cefrListening ?? profile.cefrSpeaking);

  return { instructions, sessionId, history, remainingSeconds, ttsSpeed };
}
