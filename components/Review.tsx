"use client";

import Link from "next/link";
import { startTransition, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  startReview,
  submitReview,
  type ReviewCard,
  type ReviewResult,
} from "@/app/review/actions";
import { Button } from "@/components/ui/button";
import type { Messages } from "@/lib/messages";
import {
  isSpeechRecognitionSupported,
  startListening,
  type ListeningSession,
  type SpeechErrorCode,
} from "@/lib/stt";

type Phase = "loading" | "empty" | "error" | "answering" | "submitting" | "graded";

export function Review({ messages }: { messages: Messages }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [card, setCard] = useState<ReviewCard | null>(null);
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);

  const shownAtRef = useRef<number>(0);
  const cardRef = useRef<ReviewCard | null>(null);
  const phaseRef = useRef<Phase>("loading");
  const sessionRef = useRef<ListeningSession | null>(null);

  function setPhaseBoth(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  const speechSupported = useSyncExternalStore(
    () => () => undefined,
    isSpeechRecognitionSupported,
    () => false,
  );

  function loadCard() {
    if (sessionRef.current) {
      sessionRef.current.abort();
      sessionRef.current = null;
      setIsListening(false);
    }
    // Outside the transition, so the spinner shows while the next sentence is written.
    setDraft("");
    setResult(null);
    setSpeechError(null);
    setPhaseBoth("loading");
    fetchCard();
  }

  function fetchCard() {
    startTransition(async () => {
      try {
        const res = await startReview();
        if (res.status === "ready") {
          shownAtRef.current = performance.now();
          cardRef.current = res;
          setCard(res);
          setPhaseBoth("answering");
        } else if (res.status === "empty") {
          cardRef.current = null;
          setCard(null);
          setPhaseBoth("empty");
        } else {
          cardRef.current = null;
          setCard(null);
          setPhaseBoth("error");
        }
      } catch (error) {
        console.error("Could not load review card.", error);
        cardRef.current = null;
        setCard(null);
        setPhaseBoth("error");
      }
    });
  }

  useEffect(() => {
    fetchCard();
    return () => sessionRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitAnswer(answer: string, mode: "typed" | "spoken") {
    const currentCard = cardRef.current;
    if (!currentCard || phaseRef.current === "submitting" || phaseRef.current === "graded") {
      return;
    }

    if (sessionRef.current) {
      sessionRef.current.abort();
      sessionRef.current = null;
      setIsListening(false);
    }

    setPhaseBoth("submitting");
    setSpeechError(null);

    const start = shownAtRef.current;
    const latencyMs = Math.max(0, Math.min(600_000, Math.round(performance.now() - start)));

    startTransition(async () => {
      try {
        const res = await submitReview(
          currentCard.cardId,
          answer,
          mode,
          latencyMs,
          currentCard.cloze,
        );
        if (res.status === "graded") {
          setResult(res);
          setPhaseBoth("graded");
        } else {
          setPhaseBoth("error");
        }
      } catch (error) {
        console.error("Could not submit review.", error);
        setPhaseBoth("error");
      }
    });
  }

  function handleFormSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (phase !== "answering") return;
    submitAnswer(draft, "typed");
  }

  function toggleListening() {
    if (isListening) {
      sessionRef.current?.stop();
      sessionRef.current = null;
      setIsListening(false);
      return;
    }

    setSpeechError(null);
    const session = startListening({
      continuous: false,
      onUpdate: (text) => {
        setDraft(text);
      },
      onEnd: (finalText) => {
        sessionRef.current = null;
        setIsListening(false);
        const trimmed = finalText.trim();
        if (trimmed.length > 0) {
          setDraft(trimmed);
          submitAnswer(trimmed, "spoken");
        }
      },
      onError: (code: SpeechErrorCode) => {
        sessionRef.current = null;
        setIsListening(false);
        setSpeechError(messages.speech[code] ?? messages.speech.failed);
      },
    });

    if (session) {
      sessionRef.current = session;
      setIsListening(true);
    }
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-oceanic-border pb-4">
        <h1 className="font-heading text-2xl font-bold text-oceanic-imperial sm:text-3xl">
          {messages.review.title}
        </h1>
        {card && (phase === "answering" || phase === "submitting" || phase === "graded") ? (
          <span className="rounded-full border border-oceanic-border bg-oceanic-subtle px-3 py-1 text-xs font-semibold tracking-wider text-oceanic-secondary">
            {messages.review.due} {card.due}
          </span>
        ) : null}
      </div>

      {/* Loading state */}
      {phase === "loading" ? (
        <div className="flex min-h-64 items-center justify-center rounded-lg border border-oceanic-border bg-white p-8 shadow-sm">
          <div className="size-8 rounded-full border-2 border-oceanic-border border-t-oceanic-imperial animate-spin" />
        </div>
      ) : null}

      {/* Empty state */}
      {phase === "empty" ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-oceanic-border bg-white p-8 text-center shadow-sm sm:p-12">
          <h2 className="font-heading text-xl font-bold text-oceanic-imperial sm:text-2xl">
            {messages.review.emptyTitle}
          </h2>
          <p className="max-w-md text-sm text-oceanic-muted">{messages.review.emptyBody}</p>
          <div className="pt-2">
            <Link
              href="/history"
              className="inline-flex h-10 items-center justify-center rounded bg-oceanic-imperial px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-oceanic-persian active:bg-oceanic-ocean"
            >
              {messages.review.toHistory}
            </Link>
          </div>
        </div>
      ) : null}

      {/* Error state */}
      {phase === "error" ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-oceanic-border bg-white p-8 text-center shadow-sm sm:p-12">
          <p
            role="alert"
            className="rounded border border-oceanic-error/20 bg-oceanic-error-container px-3 py-2 text-xs font-medium text-oceanic-on-error-container"
          >
            {messages.review.error}
          </p>
          <Button type="button" onClick={loadCard} className="h-10 rounded px-5 font-semibold">
            {messages.review.retry}
          </Button>
        </div>
      ) : null}

      {/* Card: answering, submitting, or graded */}
      {card && (phase === "answering" || phase === "submitting" || phase === "graded") ? (
        <div className="flex flex-col gap-6 rounded-lg border border-oceanic-border bg-white p-6 shadow-sm sm:p-8">
          {/* Meaning & Prompt */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold tracking-wider text-oceanic-muted uppercase">
              {messages.review.meaning}
            </span>
            <p className="text-lg font-medium text-oceanic-imperial">{card.prompt}</p>
          </div>

          {/* Cloze or noSentence */}
          <div className="py-2">
            {card.cloze ? (
              <p className="font-heading text-2xl font-bold text-oceanic-imperial sm:text-3xl">
                {card.cloze}
              </p>
            ) : (
              <p className="text-sm text-oceanic-muted">{messages.review.noSentence}</p>
            )}
          </div>

          {/* Form area: answering or submitting */}
          {phase === "answering" || phase === "submitting" ? (
            <div className="flex flex-col gap-4">
              <form onSubmit={handleFormSubmit} className="flex flex-col gap-3">
                {speechError ? (
                  <p
                    role="alert"
                    className="rounded border border-oceanic-error/20 bg-oceanic-error-container px-3 py-2 text-xs font-medium text-oceanic-on-error-container"
                  >
                    {speechError}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2.5">
                  <label htmlFor="review-answer" className="sr-only">
                    {messages.review.placeholder}
                  </label>
                  <input
                    id="review-answer"
                    type="text"
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      if (speechError) setSpeechError(null);
                    }}
                    placeholder={messages.review.placeholder}
                    disabled={phase === "submitting"}
                    className="h-10 min-w-0 flex-1 rounded border border-oceanic-border bg-white px-3.5 text-sm text-oceanic-imperial placeholder-oceanic-muted outline-none transition-all focus:border-oceanic-ocean focus:ring-2 focus:ring-oceanic-surge/30 disabled:opacity-50"
                  />
                  <Button
                    type="submit"
                    disabled={phase === "submitting"}
                    className="h-10 rounded px-5 font-semibold"
                  >
                    {messages.review.check}
                  </Button>
                  {speechSupported ? (
                    <Button
                      type="button"
                      variant={isListening ? "secondary" : "outline"}
                      onClick={toggleListening}
                      disabled={phase === "submitting"}
                      className="h-10 rounded px-4"
                    >
                      {isListening ? messages.review.stopSpeaking : messages.review.speak}
                    </Button>
                  ) : null}
                </div>
              </form>
            </div>
          ) : null}

          {/* Graded section */}
          {phase === "graded" && result ? (
            <div className="flex flex-col gap-4 border-t border-oceanic-border pt-4">
              <div className="flex flex-col gap-1">
                <h2
                  className={`font-heading text-xl font-bold sm:text-2xl ${
                    result.result === "correct"
                      ? "text-oceanic-ocean"
                      : result.result === "close"
                        ? "text-oceanic-secondary"
                        : "text-oceanic-error"
                  }`}
                >
                  {result.result === "correct"
                    ? messages.review.correct
                    : result.result === "close"
                      ? messages.review.close
                      : messages.review.wrong}
                </h2>
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="text-oceanic-muted">{messages.review.answer}</span>
                  <span className="font-semibold text-oceanic-imperial">{result.expected}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="rounded border border-oceanic-border bg-oceanic-subtle px-2.5 py-1 text-xs font-semibold tracking-wider text-oceanic-secondary">
                  {messages.review.ratings[String(result.rating) as "1" | "2" | "3" | "4"]}
                </span>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  type="button"
                  onClick={loadCard}
                  className="h-10 rounded px-5 font-semibold"
                >
                  {messages.review.next}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
