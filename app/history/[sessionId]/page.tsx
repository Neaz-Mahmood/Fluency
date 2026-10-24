import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { formatSessionDate, formatSessionTitle } from "@/app/history/format";
import { Recap } from "@/components/Recap";
import { Transcript } from "@/components/Transcript";
import { savedTargetItems } from "@/lib/cards";
import { getDb } from "@/lib/db";
import { getFeedback } from "@/lib/feedback-store";
import { getLearner } from "@/lib/learner";
import { isUuid } from "@/lib/learner-id";
import { getMessages } from "@/lib/messages";
import { findSession, loadTurns } from "@/lib/sessions";

export const metadata: Metadata = {
  title: "Conversation",
  description: "Read-only conversation transcript.",
};

type Params = Promise<{ sessionId: string }>;

export default function HistoryDetailPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <HistoryDetail params={params} />
    </Suspense>
  );
}

async function HistoryDetail({ params }: { params: Params }) {
  const { sessionId } = await params;
  if (!isUuid(sessionId)) {
    notFound();
  }

  const learner = await getLearner();
  const session = await findSession(getDb(), {
    learnerId: learner.learnerId,
    sessionId,
  });
  if (!session) {
    notFound();
  }

  const turns = await loadTurns(getDb(), sessionId);
  const feedback =
    session.mode !== "placement"
      ? await getFeedback(getDb(), { learnerId: learner.learnerId, sessionId })
      : null;
  const savedItems =
    feedback?.status === "done"
      ? await savedTargetItems(getDb(), learner.learnerId, [
          ...feedback.items.flatMap((item) =>
            item.edits
              .map((edit) => edit.correction.trim())
              .filter((correction) => correction !== ""),
          ),
          ...feedback.vocabulary.map((vocab) => vocab.item),
        ])
      : new Set<string>();
  const messages = getMessages(learner.nativeLanguage);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-oceanic-border pb-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-oceanic-imperial sm:text-3xl">
            {formatSessionTitle(session)}
          </h1>
          <p className="mt-1 text-xs text-oceanic-muted">{formatSessionDate(session.startedAt)}</p>
        </div>
        <Link
          href="/history"
          className="rounded border border-oceanic-border bg-white px-3 py-1.5 text-xs font-medium text-oceanic-muted transition-colors hover:border-oceanic-ocean hover:text-oceanic-imperial"
        >
          Back to history
        </Link>
      </div>

      {feedback ? (
        <Recap
          sessionId={sessionId}
          savedItems={savedItems}
          feedback={feedback}
          messages={messages}
        />
      ) : null}

      <div className="flex min-h-96 flex-1 flex-col overflow-y-auto rounded-lg border border-oceanic-border bg-oceanic-subtle p-5 shadow-inner">
        <Transcript turns={turns} interim="" messages={messages} />
      </div>
    </div>
  );
}
