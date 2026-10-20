import { Headphones, Mic } from "lucide-react";

type TranscriptTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function Transcript({
  turns,
  interim,
}: {
  turns: TranscriptTurn[];
  interim: string;
}) {
  if (turns.length === 0 && !interim) {
    return (
      <div className="m-auto flex max-w-md flex-col items-center justify-center rounded-lg border border-[#d8e2ed] bg-white p-8 text-center shadow-[0_2px_8px_-2px_rgba(3,37,108,0.05)]">
        <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-[#06bee1]/35 bg-[#06bee1]/10 text-[#03256c]">
          <Mic className="size-5 text-[#1768ac]" />
        </div>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#d8e2ed] bg-[#f4f7fb] px-2.5 py-0.5 text-[11px] font-semibold tracking-wider text-[#0461a4] uppercase">
          <span className="size-1.5 rounded-full bg-[#06bee1]" />
          Ready to listen
        </div>
        <h3 className="font-heading text-lg font-semibold text-[#03256c]">
          Start the conversation
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-[#556b82]">
          Hold the talk button to speak naturally, or type a sentence below to begin your dialogue.
        </p>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-4">
      {turns.map((turn) => (
        <li
          key={turn.id}
          className={
            turn.role === "user"
              ? "ml-auto max-w-[85%] rounded-lg bg-[#03256c] p-4 text-white shadow-[0_2px_8px_-2px_rgba(3,37,108,0.18)]"
              : "mr-auto max-w-[85%] rounded-lg border border-[#d8e2ed] bg-white p-4 text-[#1a1c1c] shadow-[0_2px_8px_-2px_rgba(3,37,108,0.05)]"
          }
        >
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className={
                turn.role === "user"
                  ? "flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-[#788fdb] uppercase"
                  : "flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-[#0461a4] uppercase"
              }
            >
              {turn.role === "user" ? (
                <>
                  <Mic className="size-3 text-[#788fdb]" />
                  <span>You</span>
                </>
              ) : (
                <>
                  <Headphones className="size-3 text-[#0461a4]" />
                  <span>Partner</span>
                </>
              )}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed sm:text-base">
            {turn.content}
          </p>
        </li>
      ))}

      {interim ? (
        <li className="ml-auto max-w-[85%] rounded-lg border-l-2 border-[#06bee1] bg-[#03256c]/90 p-4 text-white shadow-[0_2px_8px_-2px_rgba(3,37,108,0.18)]">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="size-1.5 animate-pulse rounded-full bg-[#06bee1]" />
            <span className="text-[11px] font-semibold tracking-wider text-[#06bee1] uppercase">
              Listening...
            </span>
          </div>
          <p className="text-sm leading-relaxed text-white/90 sm:text-base">
            {interim}
          </p>
        </li>
      ) : null}
    </ol>
  );
}
