import type { Metadata } from "next";
import { Suspense } from "react";

import { Conversation } from "@/components/Conversation";
import type { SavedConversation } from "@/hooks/useConversation";
import { getDb } from "@/lib/db";
import { getLearner } from "@/lib/learner";
import { isUuid } from "@/lib/learner-id";
import { isScenarioId } from "@/lib/scenarios";
import { findOpenSession, loadTurns } from "@/lib/sessions";

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
  return <Conversation saved={await loadSavedConversation(session)} />;
}

// The conversation in ?session=, so a reload shows it again. Only the learner's own open
// sessions load; anything else starts a fresh conversation.
async function loadSavedConversation(sessionId: unknown): Promise<SavedConversation | null> {
  if (!isUuid(sessionId)) return null;
  try {
    const learner = await getLearner();
    const session = await findOpenSession(getDb(), { learnerId: learner.learnerId, sessionId });
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
