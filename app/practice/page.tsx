import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { Conversation } from "@/components/Conversation";
import type { SavedConversation } from "@/hooks/useConversation";
import { getDb } from "@/lib/db";
import type { LearnerProfile } from "@/lib/db/schema";
import { getLearner } from "@/lib/learner";
import { isUuid } from "@/lib/learner-id";
import { getMessages } from "@/lib/messages";
import { isScenarioId } from "@/lib/scenarios";
import { findOpenSession, loadTurns } from "@/lib/sessions";
import { liveVoiceConfig } from "@/lib/voice-token";

export const metadata: Metadata = {
  title: "Practice",
  description: "Have a spoken English conversation with Fluency.",
};

type SearchParams = Promise<{ session?: string | string[] }>;

export default function PracticePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={null}>
      <PracticeConversation searchParams={searchParams} />
    </Suspense>
  );
}

async function PracticeConversation({ searchParams }: { searchParams: SearchParams }) {
  const { session } = await searchParams;
  let learner: LearnerProfile | null = null;
  try {
    learner = await getLearner();
  } catch (error) {
    unstable_rethrow(error);
    console.error("Could not load the learner.", error);
  }

  if (learner && learner.nativeLanguage === null) {
    redirect("/onboarding");
  }

  const saved = learner ? await loadSavedConversation(learner, session) : null;
  const liveVoice = {
    available: liveVoiceConfig() !== null,
    consented: learner?.voiceConsentAt != null,
  };
  return (
    <Conversation
      saved={saved}
      messages={getMessages(learner?.nativeLanguage)}
      liveVoice={liveVoice}
    />
  );
}

// The conversation in ?session=, so a reload shows it again. Only the learner's own open
// sessions load; anything else starts a fresh conversation.
async function loadSavedConversation(
  learner: LearnerProfile,
  sessionId: unknown,
): Promise<SavedConversation | null> {
  if (!isUuid(sessionId)) return null;
  try {
    const session = await findOpenSession(getDb(), {
      learnerId: learner.learnerId,
      sessionId,
      mode: "conversation",
    });
    if (!session?.scenarioId || !isScenarioId(session.scenarioId)) return null;
    return {
      sessionId: session.sessionId,
      scenarioId: session.scenarioId,
      turns: await loadTurns(getDb(), session.sessionId),
    };
  } catch (error) {
    console.error("Could not load the saved conversation.", error);
    return null;
  }
}
