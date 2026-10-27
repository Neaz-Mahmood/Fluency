import type { Messages } from "@/lib/messages";
import { findPattern } from "@/lib/pronunciation-patterns";
import type { PronunciationTip, SessionPronunciation } from "@/lib/pronunciation-recap";

export function PronunciationRecap({
  status,
  tips,
  summary,
  messages,
}: {
  status: "pending" | "done" | "failed";
  tips: PronunciationTip[];
  summary: SessionPronunciation | null;
  messages: Messages;
}) {
  if (status === "done" && summary === null) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 border-t border-oceanic-border pt-4">
      <h3 className="font-heading text-base font-semibold text-oceanic-imperial">
        {messages.pronunciation.title}
      </h3>

      {status === "pending" ? (
        <p className="text-sm leading-relaxed text-oceanic-muted">
          {messages.pronunciation.pending}
        </p>
      ) : status === "failed" ? (
        <p className="text-sm leading-relaxed text-oceanic-muted">
          {messages.pronunciation.failed}
        </p>
      ) : summary ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                [messages.pronunciation.accuracy, summary.accuracy],
                [messages.pronunciation.fluency, summary.fluency],
                [messages.pronunciation.prosody, summary.prosody],
              ] as const
            ).map(([label, score]) => (
              <div
                key={label}
                className="flex flex-col gap-1 rounded border border-oceanic-border bg-oceanic-subtle p-3"
              >
                <span className="text-xs font-medium text-oceanic-muted">{label}</span>
                <span className="text-lg font-semibold text-oceanic-imperial">{score ?? "–"}</span>
              </div>
            ))}
          </div>

          {/* Tips */}
          {tips.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-oceanic-imperial">
                {messages.pronunciation.tips}
              </span>
              <ul className="flex flex-col gap-1">
                {tips.map((item, index) => (
                  <li key={index} className="text-sm leading-relaxed text-oceanic-imperial">
                    {item.tip}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Sounds */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-oceanic-imperial">
              {messages.pronunciation.sounds}
            </span>
            {summary.patterns.length === 0 ? (
              <p className="text-sm leading-relaxed text-oceanic-muted">
                {messages.pronunciation.noPatterns}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {summary.patterns.map((pattern) => {
                  const catalog = findPattern(pattern.code);
                  if (!catalog) {
                    return null;
                  }
                  return (
                    <li
                      key={pattern.code}
                      className="rounded border border-oceanic-border bg-oceanic-subtle p-3 text-sm"
                    >
                      <span className="font-bold text-oceanic-imperial">
                        {catalog.target} → {catalog.heard}
                      </span>
                      <p className="text-xs text-oceanic-muted">
                        {messages.pronunciation.inWords}: {pattern.words.join(", ")}
                      </p>
                      <p className="text-xs italic text-oceanic-muted">{catalog.tip}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Words */}
          {summary.weakWords.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-oceanic-imperial">
                {messages.pronunciation.words}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {summary.weakWords.map((item) => (
                  <span
                    key={item.word}
                    className="inline-flex items-center rounded border border-oceanic-border bg-white px-2 py-0.5 text-xs text-oceanic-muted"
                  >
                    {item.word} · {item.score}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* Footer */}
          <p className="text-[11px] text-oceanic-muted">
            {messages.pronunciation.scoredTurns}: {summary.scoredTurns} ·{" "}
            {messages.pronunciation.scoreNote}
          </p>
        </>
      ) : null}
    </div>
  );
}
