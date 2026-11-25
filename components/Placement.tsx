"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef } from "react";

import { finishPlacement, type PlacementResult } from "@/app/placement/actions";
import { ConversationControls } from "@/components/ConversationControls";
import { Transcript } from "@/components/Transcript";
import { Button } from "@/components/ui/button";
import { useConversation } from "@/hooks/useConversation";
import type { Messages } from "@/lib/messages";
import { PLACEMENT_MAX_ANSWERS } from "@/lib/placement";

export function Placement({ messages }: { messages: Messages }) {
  const conversation = useConversation({
    target: { mode: "placement" },
    saved: null,
    messages,
    maxAnswers: PLACEMENT_MAX_ANSWERS,
  });

  const answers = conversation.turns.filter((turn) => turn.role === "user").length;
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const [state, action, pending] = useActionState<PlacementResult | { status: "idle" }>(
    async () => finishPlacement(conversation.getSessionId()),
    { status: "idle" },
  );

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [conversation.turns, conversation.interim, conversation.status]);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-oceanic-border pb-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-bold text-oceanic-imperial sm:text-3xl">
            {messages.placement.title}
          </h1>
          <p className="max-w-2xl text-sm text-oceanic-muted">{messages.placement.intro}</p>
        </div>
        <span className="rounded-full border border-oceanic-border bg-white px-3 py-1 text-xs font-semibold tracking-wider text-oceanic-secondary uppercase">
          {messages.placement.progress}: {answers}/{PLACEMENT_MAX_ANSWERS}
        </span>
      </div>

      {/* Transcript Box */}
      <div
        ref={transcriptRef}
        className="flex min-h-96 flex-1 flex-col overflow-y-auto rounded-lg border border-oceanic-border bg-oceanic-subtle p-5 shadow-inner"
        aria-live="polite"
      >
        <Transcript
          turns={conversation.turns}
          interim={conversation.interim}
          messages={messages}
        />
      </div>

      {/* Action / Result Area */}
      {answers < PLACEMENT_MAX_ANSWERS || conversation.status !== "idle" ? (
        <ConversationControls conversation={conversation} messages={messages} />
      ) : state.status === "done" ? (
        <div className="sticky bottom-0 z-10 flex flex-col gap-4 rounded-lg border border-oceanic-border bg-white p-5 shadow-[0_8px_24px_-4px_rgba(3,37,108,0.10)]">
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-xl font-bold text-oceanic-imperial">
              {messages.placement.resultTitle}
            </h2>
            <p className="text-xs text-oceanic-muted">{messages.placement.resultNote}</p>
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col rounded-md border border-oceanic-border bg-oceanic-subtle px-4 py-3">
              <span className="text-xs font-medium text-oceanic-muted">
                {messages.placement.speaking}
              </span>
              <span className="font-heading text-2xl font-bold text-oceanic-imperial">
                {state.speaking}
              </span>
            </div>
            <div className="flex flex-col rounded-md border border-oceanic-border bg-oceanic-subtle px-4 py-3">
              <span className="text-xs font-medium text-oceanic-muted">
                {messages.placement.writing}
              </span>
              <span className="font-heading text-2xl font-bold text-oceanic-imperial">
                {state.writing}
              </span>
            </div>
          </div>
          <div>
            <Link
              href="/practice"
              className="inline-flex h-10 items-center justify-center rounded bg-oceanic-imperial px-5 text-sm font-semibold text-white shadow-[0_2px_8px_-2px_rgba(3,37,108,0.2)] transition-colors hover:bg-oceanic-persian active:bg-oceanic-ocean"
            >
              {messages.placement.startPracticing}
            </Link>
          </div>
        </div>
      ) : (
        <div className="sticky bottom-0 z-10 flex flex-col gap-4 rounded-lg border border-oceanic-border bg-white p-5 shadow-[0_8px_24px_-4px_rgba(3,37,108,0.10)]">
          {state.status === "error" ? (
            <p
              role="alert"
              className="rounded border border-oceanic-error/20 bg-oceanic-error-container px-3 py-2 text-xs font-medium text-oceanic-on-error-container"
            >
              {messages.placement.error}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              disabled={pending}
              onClick={() => startTransition(action)}
              className="h-10 rounded bg-oceanic-imperial px-5 font-semibold text-white shadow-[0_2px_8px_-2px_rgba(3,37,108,0.2)] transition-all hover:bg-oceanic-persian active:bg-oceanic-ocean"
            >
              {pending
                ? messages.placement.finishing
                : state.status === "error"
                  ? messages.placement.retry
                  : messages.placement.finish}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
