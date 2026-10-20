"use client";

import { FormEvent, PointerEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square } from "lucide-react";

import { ScenarioPicker } from "@/components/ScenarioPicker";
import { Transcript } from "@/components/Transcript";
import { Button } from "@/components/ui/button";
import { SCENARIOS, type ScenarioId } from "@/lib/scenarios";
import { isSpeechRecognitionSupported, startListening, type ListeningSession } from "@/lib/stt";
import { isSpeechSynthesisSupported, speakText, stopSpeaking } from "@/lib/tts";

type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Status = "idle" | "listening" | "thinking" | "speaking";

const HOLD_THRESHOLD_MS = 280;

export function Conversation() {
  const [scenarioId, setScenarioId] = useState<ScenarioId | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");
  const [handsFree, setHandsFree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const speechReady = useSyncExternalStore(
    () => () => undefined,
    isSpeechRecognitionSupported,
    () => false,
  );
  const voiceReady = useSyncExternalStore(
    () => () => undefined,
    isSpeechSynthesisSupported,
    () => false,
  );

  const statusRef = useRef<Status>("idle");
  const turnsRef = useRef<Turn[]>([]);
  const handsFreeRef = useRef(false);
  const sessionRef = useRef<ListeningSession | null>(null);
  const cancelSpeechRef = useRef<(() => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnToken = useRef(0);
  const pressStarted = useRef(0);
  const releaseSends = useRef(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  useEffect(() => {
    handsFreeRef.current = handsFree;
  }, [handsFree]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [turns, interim, status]);

  useEffect(() => {
    return () => {
      sessionRef.current?.abort();
      cancelSpeechRef.current?.();
      abortRef.current?.abort();
      stopSpeaking();
    };
  }, []);

  function nextToken() {
    turnToken.current += 1;
    return turnToken.current;
  }

  function isCurrent(token: number) {
    return turnToken.current === token;
  }

  function stopListening(abort: boolean) {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) return;
    if (abort) session.abort();
    else session.stop();
  }

  function beginListening(continuous: boolean) {
    if (statusRef.current === "thinking") return;
    stopListening(true);
    cancelSpeechRef.current?.();
    cancelSpeechRef.current = null;
    stopSpeaking();
    setError(null);
    setInterim("");
    setStatus("listening");

    const session = startListening({
      continuous,
      onUpdate: (text) => setInterim(text),
      onError: (message) => {
        setError(message);
        setStatus("idle");
        setInterim("");
      },
      onEnd: (finalText) => {
        sessionRef.current = null;
        setInterim("");
        if (!finalText) {
          setStatus("idle");
          return;
        }
        void sendUserText(finalText);
      },
    });

    if (!session) {
      setStatus("idle");
      setError("This browser cannot hear you. Type your line instead.");
      return;
    }
    sessionRef.current = session;
  }

  function finishListening() {
    if (statusRef.current !== "listening") return;
    stopListening(false);
  }

  async function sendUserText(text: string) {
    const content = text.trim();
    if (!content || !scenarioId || statusRef.current === "thinking") return;

    stopListening(true);
    cancelSpeechRef.current?.();
    stopSpeaking();
    abortRef.current?.abort();

    const token = nextToken();
    const userTurn: Turn = { id: crypto.randomUUID(), role: "user", content };
    const history = [...turnsRef.current, userTurn];
    const assistantId = crypto.randomUUID();
    setTurns(history);
    setDraft("");
    setInterim("");
    setError(null);
    setStatus("thinking");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          scenarioId,
          messages: history.map(({ role, content: turnContent }) => ({
            role,
            content: turnContent,
          })),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "The conversation partner could not reply.");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("The reply stream was empty.");

      const decoder = new TextDecoder();
      let reply = "";
      setTurns((current) => [...current, { id: assistantId, role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        if (!isCurrent(token)) return;
        const snapshot = reply;
        setTurns((current) =>
          current.map((turn) => (turn.id === assistantId ? { ...turn, content: snapshot } : turn)),
        );
      }
      reply += decoder.decode();

      if (!isCurrent(token)) return;
      const finalReply = reply.trim();
      if (!finalReply) throw new Error("The partner did not say anything. Try again.");

      setTurns((current) =>
        current.map((turn) => (turn.id === assistantId ? { ...turn, content: finalReply } : turn)),
      );
      speakReply(finalReply, token);
    } catch (caught) {
      if (!isCurrent(token) || (caught instanceof DOMException && caught.name === "AbortError")) {
        return;
      }
      setTurns((current) => current.filter((turn) => turn.content.trim().length > 0));
      setStatus("idle");
      setError(caught instanceof Error ? caught.message : "The reply failed.");
    }
  }

  function speakReply(text: string, token: number) {
    if (!isSpeechSynthesisSupported()) {
      setStatus("idle");
      if (handsFreeRef.current) beginListening(false);
      return;
    }

    cancelSpeechRef.current = speakText(text, {
      onStart: () => {
        if (isCurrent(token)) setStatus("speaking");
      },
      onError: () => {
        if (!isCurrent(token)) return;
        setStatus("idle");
        setError("The reply could not be spoken. You can still read it.");
      },
      onEnd: () => {
        cancelSpeechRef.current = null;
        if (!isCurrent(token)) return;
        setStatus("idle");
        if (handsFreeRef.current) beginListening(false);
      },
    });
  }

  function interrupt() {
    nextToken();
    abortRef.current?.abort();
    stopListening(true);
    cancelSpeechRef.current?.();
    cancelSpeechRef.current = null;
    stopSpeaking();
    setInterim("");
    setStatus("idle");
    setTurns((current) => current.filter((turn) => turn.content.trim().length > 0));
  }

  function onMicPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || statusRef.current === "thinking") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (statusRef.current === "listening") {
      releaseSends.current = true;
      return;
    }
    releaseSends.current = false;
    pressStarted.current = Date.now();
    beginListening(true);
  }

  function onMicPointerUp() {
    if (statusRef.current !== "listening") return;
    const held = Date.now() - pressStarted.current;
    if (releaseSends.current || held >= HOLD_THRESHOLD_MS) {
      releaseSends.current = false;
      finishListening();
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void sendUserText(draft);
  }

  const scenario = SCENARIOS.find((item) => item.id === scenarioId);

  if (!scenarioId || !scenario) {
    return (
      <ScenarioPicker
        onSelect={(id) => {
          interrupt();
          setTurns([]);
          setScenarioId(id);
        }}
      />
    );
  }

  const busy = status === "thinking" || status === "speaking";
  const statusLabel =
    status === "listening"
      ? "Listening…"
      : status === "thinking"
        ? "Processing…"
        : status === "speaking"
          ? "Speaking…"
          : handsFree
            ? "Hands-free active"
            : "Ready for input";

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4">
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#d8e2ed] pb-4">
        <div>
          <span className="text-[11px] font-semibold tracking-wider text-[#0461a4] uppercase">
            Active Scenario
          </span>
          <h1 className="font-heading text-2xl font-bold text-[#03256c] sm:text-3xl">
            {scenario.title}
          </h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded text-xs"
          onClick={() => {
            interrupt();
            setTurns([]);
            setScenarioId(null);
          }}
        >
          Switch scenario
        </Button>
      </div>

      {/* Transcript Box (Level 0/Subtle) */}
      <div
        ref={transcriptRef}
        className="flex min-h-96 flex-1 flex-col overflow-y-auto rounded-lg border border-[#d8e2ed] bg-[#f4f7fb] p-5 shadow-inner"
        aria-live="polite"
      >
        <Transcript turns={turns} interim={interim} />
      </div>

      {/* Action Control Panel (Level 2 Elevation) */}
      <div className="sticky bottom-0 z-10 flex flex-col gap-4 rounded-lg border border-[#d8e2ed] bg-white p-5 shadow-[0_8px_24px_-4px_rgba(3,37,108,0.10)]">
        {/* Status & Options Row */}
        <div className="flex items-center justify-between gap-3 border-b border-[#d8e2ed] pb-3">
          <div className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${
                status === "listening"
                  ? "bg-[#06bee1] shadow-[0_0_8px_#06bee1] animate-pulse"
                  : status === "thinking"
                    ? "bg-[#2541b2] animate-bounce"
                    : status === "speaking"
                      ? "bg-[#1768ac] animate-pulse"
                      : "bg-[#757682]"
              }`}
            />
            <span className="text-xs font-medium text-[#556b82]">{statusLabel}</span>
          </div>

          {/* Interactive Filter Chip (Hands-free toggle) */}
          <button
            type="button"
            aria-pressed={handsFree}
            onClick={() => setHandsFree((value) => !value)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tracking-wider uppercase transition-colors cursor-pointer ${
              handsFree
                ? "border border-[#03256c] bg-[#03256c] text-white"
                : "border border-[#d8e2ed] bg-white text-[#556b82] hover:border-[#1768ac] hover:text-[#03256c]"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                handsFree ? "bg-[#06bee1]" : "bg-[#c5c6d2]"
              }`}
            />
            Hands-free
          </button>
        </div>

        {error ? (
          <p className="rounded border border-[#ba1a1a]/20 bg-[#ffdad6] px-3 py-2 text-xs font-medium text-[#93000a]">
            {error}
          </p>
        ) : null}

        {!speechReady ? (
          <p className="text-xs text-[#556b82]">
            Speech recognition is unavailable in this browser. You can type your lines, and replies will be vocalized
            {voiceReady ? "." : " if audio synthesis is available."}
          </p>
        ) : null}

        {/* Voice Trigger Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            className={`h-12 touch-none gap-2 rounded px-6 font-semibold text-white shadow-[0_2px_8px_-2px_rgba(3,37,108,0.2)] transition-all ${
              status === "listening"
                ? "bg-[#03256c] ring-2 ring-[#06bee1] shadow-[0_0_12px_rgba(6,190,225,0.4)]"
                : "bg-[#03256c] hover:bg-[#2541b2] active:bg-[#1768ac]"
            }`}
            disabled={!speechReady || status === "thinking"}
            aria-pressed={status === "listening"}
            onPointerDown={onMicPointerDown}
            onPointerUp={onMicPointerUp}
            onPointerCancel={finishListening}
          >
            <Mic className={`size-4 ${status === "listening" ? "text-[#06bee1]" : "text-white"}`} />
            {status === "listening" ? "Release to send" : "Hold to talk"}
          </Button>

          {busy || status === "listening" ? (
            <Button
              type="button"
              variant="outline"
              className="h-12 gap-1.5 rounded px-4"
              onClick={interrupt}
            >
              <Square className="size-3.5 fill-current text-[#ba1a1a]" />
              Stop
            </Button>
          ) : null}
        </div>

        {/* Text Input Fallback (Oceanic Form Input) */}
        <form onSubmit={onSubmit} className="flex gap-2.5">
          <label className="sr-only" htmlFor="line">
            Type a message
          </label>
          <input
            id="line"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Or type what you would say..."
            disabled={status === "thinking"}
            className="h-10 min-w-0 flex-1 rounded border border-[#d8e2ed] bg-white px-3.5 text-sm text-[#03256c] placeholder-[#556b82] outline-none transition-all focus:border-[#1768ac] focus:ring-2 focus:ring-[#06bee1]/30 disabled:opacity-50"
          />
          <Button
            type="submit"
            className="h-10 rounded px-5"
            disabled={!draft.trim() || status === "thinking"}
          >
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}
