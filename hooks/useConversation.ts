"use client";

import { FormEvent, PointerEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { ScenarioId } from "@/lib/scenarios";
import { isSpeechRecognitionSupported, startListening, type ListeningSession } from "@/lib/stt";
import { isSpeechSynthesisSupported, speakText, stopSpeaking } from "@/lib/tts";

export type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

// A conversation loaded from the database, so a reload picks up where it left off.
export type SavedConversation = {
  sessionId: string;
  scenarioId: ScenarioId;
  turns: Turn[];
};

export type Status = "idle" | "listening" | "thinking" | "speaking";

export type ChatTarget = { scenarioId: ScenarioId };

const HOLD_THRESHOLD_MS = 280;

export function useConversation({
  target,
  saved,
}: {
  target: ChatTarget | null;
  saved: SavedConversation | null;
}) {
  const [turns, setTurns] = useState<Turn[]>(saved?.turns ?? []);
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
  const turnsRef = useRef<Turn[]>(saved?.turns ?? []);
  const handsFreeRef = useRef(false);
  const sessionRef = useRef<ListeningSession | null>(null);
  // The saved conversation, from the X-Session-Id header of the first reply.
  const chatSessionIdRef = useRef<string | null>(saved?.sessionId ?? null);
  const cancelSpeechRef = useRef<(() => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnToken = useRef(0);
  const pressStarted = useRef(0);
  const releaseSends = useRef(false);

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
        void sendUserText(finalText, "voice");
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

  async function sendUserText(text: string, inputMode: "voice" | "typed") {
    const content = text.trim();
    if (!content || !target || statusRef.current === "thinking") return;

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

    let received = "";

    try {
      let response: Response;
      try {
        response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            ...target,
            sessionId: chatSessionIdRef.current ?? undefined,
            inputMode,
            message: content,
          }),
        });
      } catch (caughtFetch) {
        if (
          controller.signal.aborted ||
          (caughtFetch instanceof DOMException && caughtFetch.name === "AbortError")
        ) {
          throw caughtFetch;
        }
        throw new Error("The conversation partner could not reply.");
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "The conversation partner could not reply.");
      }

      const sessionId = response.headers.get("X-Session-Id");
      if (sessionId) {
        chatSessionIdRef.current = sessionId;
        // Keeps the session in the URL so a reload loads it (app/practice/page.tsx).
        window.history.replaceState(null, "", `?session=${sessionId}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("The conversation partner could not reply.");

      const decoder = new TextDecoder();
      setTurns((current) => [...current, { id: assistantId, role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += decoder.decode(value, { stream: true });
        if (!isCurrent(token)) return;
        const snapshot = received;
        setTurns((current) =>
          current.map((turn) => (turn.id === assistantId ? { ...turn, content: snapshot } : turn)),
        );
      }
      received += decoder.decode();

      if (!isCurrent(token)) return;
      const finalReply = received.trim();
      if (!finalReply) throw new Error("The partner did not say anything. Try again.");

      setTurns((current) =>
        current.map((turn) => (turn.id === assistantId ? { ...turn, content: finalReply } : turn)),
      );
      speakReply(finalReply, token);
    } catch (caught) {
      if (!isCurrent(token) || (caught instanceof DOMException && caught.name === "AbortError")) {
        return;
      }
      if (received.trim().length > 0) {
        setTurns((current) =>
          current.map((turn) =>
            turn.id === assistantId ? { ...turn, content: received.trim() } : turn,
          ),
        );
        setError("The reply was cut off. You can keep going.");
      } else {
        setTurns((current) =>
          current.filter((turn) => turn.id !== userTurn.id && turn.id !== assistantId),
        );
        setDraft(content);
        setError(
          caught instanceof Error ? caught.message : "The conversation partner could not reply.",
        );
      }
      setStatus("idle");
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

  function reset() {
    interrupt();
    setTurns([]);
    turnsRef.current = [];
    chatSessionIdRef.current = null;
    window.history.replaceState(null, "", window.location.pathname);
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
    void sendUserText(draft, "typed");
  }

  const toggleHandsFree = () => setHandsFree((value) => !value);

  return {
    turns,
    status,
    interim,
    error,
    draft,
    setDraft,
    handsFree,
    toggleHandsFree,
    speechReady,
    voiceReady,
    interrupt,
    reset,
    finishListening,
    onMicPointerDown,
    onMicPointerUp,
    onSubmit,
  };
}
