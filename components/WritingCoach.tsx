"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { submitWriting } from "@/app/write/actions";
import { Button } from "@/components/ui/button";
import { MAX_CHARS } from "@/lib/chat-request";
import type { Messages } from "@/lib/messages";

type ErrorReason = "empty" | "too-long" | "failed";

export function WritingCoach({ messages }: { messages: Messages }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [errorReason, setErrorReason] = useState<ErrorReason | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !text.trim()) {
      return;
    }
    setErrorReason(null);
    startTransition(async () => {
      const result = await submitWriting(text);
      if (result.status === "ok") {
        router.push(`/history/${result.sessionId}`);
      } else {
        setErrorReason(result.reason);
      }
    });
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-oceanic-border pb-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-bold text-oceanic-imperial sm:text-3xl">
            {messages.writing.title}
          </h1>
          <p className="max-w-2xl text-sm text-oceanic-muted">{messages.writing.intro}</p>
        </div>
      </div>

      {/* Writing form area */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {errorReason ? (
          <p
            role="alert"
            className="rounded border border-oceanic-error/20 bg-oceanic-error-container px-3 py-2 text-xs font-medium text-oceanic-on-error-container"
          >
            {messages.writing.errors[errorReason]}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <textarea
            rows={10}
            maxLength={MAX_CHARS}
            placeholder={messages.writing.placeholder}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (errorReason) {
                setErrorReason(null);
              }
            }}
            disabled={pending}
            className="w-full resize-y rounded-lg border border-oceanic-border bg-white p-4 text-sm text-oceanic-imperial placeholder-oceanic-muted outline-none transition-all focus:border-oceanic-ocean focus:ring-2 focus:ring-oceanic-surge/30 disabled:opacity-50"
          />
          <div className="flex justify-end">
            <span className="text-xs font-medium text-oceanic-muted">
              {text.length} / {MAX_CHARS}
            </span>
          </div>
        </div>

        <div>
          <Button
            type="submit"
            disabled={pending || !text.trim()}
            className="h-10 rounded bg-oceanic-imperial px-5 font-semibold text-white shadow-[0_2px_8px_-2px_rgba(3,37,108,0.2)] transition-all hover:bg-oceanic-persian active:bg-oceanic-ocean"
          >
            {pending ? messages.writing.submitting : messages.writing.submit}
          </Button>
        </div>
      </form>
    </div>
  );
}
