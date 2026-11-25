"use client";

import { Mic, Square } from "lucide-react";

import { LiveVoiceControls } from "@/components/LiveVoiceControls";
import { Button } from "@/components/ui/button";
import type { Status, useConversation } from "@/hooks/useConversation";
import type { useLiveVoice } from "@/hooks/useLiveVoice";
import type { Messages } from "@/lib/messages";
import type { ScenarioId } from "@/lib/scenarios";

// Live voice is only offered in scenario conversations, not in placement.
export type LiveVoiceProps = {
  live: ReturnType<typeof useLiveVoice>;
  available: boolean;
  consented: boolean;
  scenarioId: ScenarioId;
};

export function ConversationControls({
  conversation,
  messages,
  liveVoice,
}: {
  conversation: ReturnType<typeof useConversation>;
  messages: Messages;
  liveVoice?: LiveVoiceProps;
}) {
  const {
    status,
    handsFree,
    error,
    speechReady,
    voiceReady,
    onMicPointerDown,
    onMicPointerUp,
    finishListening,
    interrupt,
    onSubmit,
    draft,
    setDraft,
    toggleHandsFree,
  } = conversation;

  const liveStatus = liveVoice?.live.status ?? "off";
  const liveOn = liveStatus !== "off";
  // While live voice is on, the status row follows the agent instead of the browser.
  const shownStatus: Status =
    liveStatus === "off" ? status : liveStatus === "connecting" ? "thinking" : liveStatus;
  const busy = status === "thinking" || status === "speaking";
  const statusLabel =
    liveStatus === "connecting"
      ? messages.liveVoice.connecting
      : shownStatus === "listening"
        ? messages.practice.statusListening
        : shownStatus === "thinking"
          ? messages.practice.statusThinking
          : shownStatus === "speaking"
            ? messages.practice.statusSpeaking
            : handsFree
              ? messages.practice.statusHandsFree
              : messages.practice.statusReady;

  return (
    <div className="sticky bottom-0 z-10 flex flex-col gap-4 rounded-lg border border-oceanic-border bg-white p-5 shadow-[0_8px_24px_-4px_rgba(3,37,108,0.10)]">
      {/* Status & Options Row */}
      <div className="flex items-center justify-between gap-3 border-b border-oceanic-border pb-3">
        <div className="flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${
              shownStatus === "listening"
                ? "bg-oceanic-surge shadow-[0_0_8px_var(--color-oceanic-surge)] animate-pulse"
                : shownStatus === "thinking"
                  ? "bg-oceanic-persian animate-bounce"
                  : shownStatus === "speaking"
                    ? "bg-oceanic-ocean animate-pulse"
                    : "bg-oceanic-outline"
            }`}
          />
          <span className="text-xs font-medium text-oceanic-muted">{statusLabel}</span>
        </div>

        {/* Interactive Filter Chip (Hands-free toggle) */}
        <button
          type="button"
          aria-pressed={handsFree}
          onClick={toggleHandsFree}
          disabled={liveOn}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tracking-wider uppercase transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            handsFree
              ? "border border-oceanic-imperial bg-oceanic-imperial text-white"
              : "border border-oceanic-border bg-white text-oceanic-muted hover:border-oceanic-ocean hover:text-oceanic-imperial"
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${handsFree ? "bg-oceanic-surge" : "bg-oceanic-outline-variant"}`}
          />
          {messages.practice.handsFree}
        </button>
      </div>

      {error ? (
        <p className="rounded border border-oceanic-error/20 bg-oceanic-error-container px-3 py-2 text-xs font-medium text-oceanic-on-error-container">
          {error}
        </p>
      ) : null}

      {!speechReady ? (
        <p className="text-xs text-oceanic-muted">
          {voiceReady
            ? messages.practice.speechUnavailable
            : messages.practice.speechUnavailableWithoutVoice}
        </p>
      ) : null}

      {liveVoice?.available ? (
        <LiveVoiceControls
          live={liveVoice.live}
          consented={liveVoice.consented}
          scenarioId={liveVoice.scenarioId}
          getSessionId={conversation.getSessionId}
          beforeStart={conversation.interrupt}
          messages={messages}
        />
      ) : null}

      {/* Voice Trigger Buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          className={`h-12 touch-none gap-2 rounded px-6 font-semibold text-white shadow-[0_2px_8px_-2px_rgba(3,37,108,0.2)] transition-all ${
            status === "listening"
              ? "bg-oceanic-imperial ring-2 ring-oceanic-surge shadow-[0_0_12px_rgba(6,190,225,0.4)]"
              : "bg-oceanic-imperial hover:bg-oceanic-persian active:bg-oceanic-ocean"
          }`}
          disabled={liveOn || !speechReady || status === "thinking"}
          aria-pressed={status === "listening"}
          onPointerDown={onMicPointerDown}
          onPointerUp={onMicPointerUp}
          onPointerCancel={finishListening}
        >
          <Mic
            className={`size-4 ${status === "listening" ? "text-oceanic-surge" : "text-white"}`}
          />
          {status === "listening" ? messages.practice.releaseToSend : messages.practice.holdToTalk}
        </Button>

        {busy || status === "listening" ? (
          <Button
            type="button"
            variant="outline"
            className="h-12 gap-1.5 rounded px-4"
            onClick={interrupt}
          >
            <Square className="size-3.5 fill-current text-oceanic-error" />
            {messages.practice.stop}
          </Button>
        ) : null}
      </div>

      {/* Text Input Fallback (Oceanic Form Input) */}
      <form onSubmit={onSubmit} className="flex gap-2.5">
        <label className="sr-only" htmlFor="line">
          {messages.practice.typeMessage}
        </label>
        <input
          id="line"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={messages.practice.placeholder}
          disabled={liveOn || status === "thinking"}
          className="h-10 min-w-0 flex-1 rounded border border-oceanic-border bg-white px-3.5 text-sm text-oceanic-imperial placeholder-oceanic-muted outline-none transition-all focus:border-oceanic-ocean focus:ring-2 focus:ring-oceanic-surge/30 disabled:opacity-50"
        />
        <Button
          type="submit"
          className="h-10 rounded px-5"
          disabled={liveOn || !draft.trim() || status === "thinking"}
        >
          {messages.practice.send}
        </Button>
      </form>
    </div>
  );
}
