import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { formatSessionDate, formatSessionTitle } from "@/app/history/format";
import { getDb } from "@/lib/db";
import { getLearner } from "@/lib/learner";
import { listSessions } from "@/lib/sessions";

export const metadata: Metadata = {
  title: "History",
  description: "Your past conversations.",
};

export default function HistoryPage() {
  return (
    <Suspense fallback={null}>
      <HistoryList />
    </Suspense>
  );
}

async function HistoryList() {
  let sessions;
  try {
    const learner = await getLearner();
    sessions = await listSessions(getDb(), learner.learnerId);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Could not load session history.", error);
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="border-b border-oceanic-border pb-4">
          <h1 className="font-heading text-2xl font-bold text-oceanic-imperial sm:text-3xl">
            History
          </h1>
        </div>
        <p className="text-sm leading-relaxed text-oceanic-muted">
          Your history can&apos;t be loaded right now. Try again in a moment.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="border-b border-oceanic-border pb-4">
        <h1 className="font-heading text-2xl font-bold text-oceanic-imperial sm:text-3xl">
          History
        </h1>
      </div>

      {sessions.length === 0 ? (
        <section className="flex flex-col items-start gap-4 rounded-lg border border-oceanic-border bg-white p-5 shadow-[0_2px_8px_-2px_rgba(3,37,108,0.05)]">
          <p className="text-sm leading-relaxed text-oceanic-muted">No conversations yet.</p>
          <Link
            href="/practice"
            className="rounded bg-oceanic-imperial px-4 py-2 text-sm font-semibold text-white shadow-[0_2px_8px_-2px_rgba(3,37,108,0.2)] transition-colors hover:bg-oceanic-persian"
          >
            Practice
          </Link>
        </section>
      ) : (
        <ul className="flex flex-col gap-3">
          {sessions.map((session) => (
            <li key={session.sessionId}>
              <Link
                href={`/history/${session.sessionId}`}
                className="flex items-center justify-between gap-4 rounded-lg border border-oceanic-border bg-white p-5 shadow-[0_2px_8px_-2px_rgba(3,37,108,0.05)] transition-all hover:border-oceanic-ocean hover:shadow-[0_8px_24px_-4px_rgba(3,37,108,0.08)]"
              >
                <div className="flex flex-col gap-1">
                  <h2 className="font-heading text-base font-semibold text-oceanic-imperial">
                    {formatSessionTitle(session)}
                  </h2>
                  <span className="text-xs text-oceanic-muted">
                    {formatSessionDate(session.startedAt)}
                  </span>
                </div>
                <span className="shrink-0 text-xs font-medium text-oceanic-muted">
                  {session.turnCount} {session.turnCount === 1 ? "turn" : "turns"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
