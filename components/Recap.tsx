import { RecapRefresher } from "@/components/RecapRefresher";
import type { SessionFeedback } from "@/lib/db/schema";
import type { Messages } from "@/lib/messages";

export function Recap({
  feedback,
  messages,
}: {
  feedback: Pick<SessionFeedback, "status" | "items" | "vocabulary">;
  messages: Messages;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-oceanic-border bg-white p-5 shadow-[0_2px_8px_-2px_rgba(3,37,108,0.05)]">
      <h2 className="font-heading text-lg font-semibold text-oceanic-imperial">
        {messages.recap.title}
      </h2>

      {feedback.status === "pending" ? (
        <>
          <p className="text-sm leading-relaxed text-oceanic-muted">{messages.recap.pending}</p>
          <RecapRefresher />
        </>
      ) : feedback.status === "failed" ? (
        <p className="text-sm leading-relaxed text-oceanic-muted">{messages.recap.failed}</p>
      ) : (
        <>
          {feedback.items.length === 0 ? (
            <p className="text-sm leading-relaxed text-oceanic-muted">{messages.recap.none}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {feedback.items.map((item) => (
                <div
                  key={`${item.turnId}-${item.line}`}
                  className="flex flex-col gap-3 rounded-md border border-oceanic-border bg-white p-4"
                >
                  <div className="grid sm:grid-cols-3 gap-3">
                    {/* You said */}
                    <div className="flex flex-col gap-1 rounded border border-oceanic-border bg-oceanic-subtle p-3">
                      <span className="text-xs font-medium text-oceanic-muted">
                        {messages.recap.youSaid}
                      </span>
                      <p className="text-sm text-oceanic-imperial">{item.original}</p>
                    </div>

                    {/* Correct form */}
                    {item.edits.length > 0 ? (
                      <div className="flex flex-col gap-1 rounded border border-oceanic-border bg-oceanic-subtle p-3">
                        <span className="text-xs font-medium text-oceanic-muted">
                          {messages.recap.correct}
                        </span>
                        <p className="text-sm font-medium text-oceanic-imperial">
                          {item.minimalCorrection}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {item.edits.map((edit, editIndex) => (
                            <span
                              key={editIndex}
                              className="inline-flex items-center rounded border border-oceanic-border bg-white px-2 py-0.5 text-xs text-oceanic-muted"
                            >
                              {edit.original} → {edit.correction}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* More natural */}
                    {item.fluencyUpgrade ? (
                      <div className="flex flex-col gap-1 rounded border border-oceanic-border bg-oceanic-subtle p-3">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className="text-xs font-medium text-oceanic-muted">
                            {messages.recap.upgrade}
                          </span>
                          <span className="text-[11px] text-oceanic-muted">
                            {item.edits.length === 0
                              ? messages.recap.upgradeOptional
                              : messages.recap.upgradeAlso}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-oceanic-imperial">
                          {item.fluencyUpgrade}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  {/* Why */}
                  {item.explanation ? (
                    <div className="flex flex-col gap-0.5 text-xs">
                      <span className="font-semibold text-oceanic-imperial">
                        {messages.recap.why}
                      </span>
                      <p className="leading-relaxed text-oceanic-muted">{item.explanation}</p>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {/* Vocabulary */}
          {feedback.vocabulary && feedback.vocabulary.length > 0 ? (
            <div className="flex flex-col gap-3 border-t border-oceanic-border pt-4">
              <h3 className="font-heading text-base font-semibold text-oceanic-imperial">
                {messages.recap.vocabulary}
              </h3>
              <ul className="flex flex-col gap-2">
                {feedback.vocabulary.map((vocab, index) => (
                  <li
                    key={index}
                    className="flex flex-col gap-0.5 rounded border border-oceanic-border bg-oceanic-subtle p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-bold text-oceanic-imperial">{vocab.item}</span>
                      <span className="text-xs text-oceanic-muted">{vocab.meaning}</span>
                    </div>
                    <p className="text-xs italic text-oceanic-muted">{vocab.example}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
