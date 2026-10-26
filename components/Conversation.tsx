"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ConversationControls } from "@/components/ConversationControls";
import { ScenarioPicker } from "@/components/ScenarioPicker";
import { Transcript } from "@/components/Transcript";
import { Button } from "@/components/ui/button";
import { useConversation, type SavedConversation } from "@/hooks/useConversation";
import { useLiveVoice } from "@/hooks/useLiveVoice";
import type { Messages } from "@/lib/messages";
import { SCENARIOS, type ScenarioId } from "@/lib/scenarios";

export function Conversation({
  saved,
  messages,
  liveVoice,
}: {
  saved: SavedConversation | null;
  messages: Messages;
  liveVoice: { available: boolean; consented: boolean };
}) {
  const router = useRouter();
  const [finishing, setFinishing] = useState(false);
  const [scenarioId, setScenarioId] = useState<ScenarioId | null>(saved?.scenarioId ?? null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const conversation = useConversation({
    target: scenarioId ? { scenarioId } : null,
    saved,
    messages,
  });
  const live = useLiveVoice({
    messages,
    onTurn: conversation.upsertTurn,
    onSessionId: conversation.adoptSession,
  });
  const { turns, status, interim } = conversation;

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [turns, interim, live.interim, status]);

  const scenario = SCENARIOS.find((item) => item.id === scenarioId);

  if (!scenarioId || !scenario) {
    return (
      <ScenarioPicker
        messages={messages}
        onSelect={(id) => {
          void live.stop();
          conversation.reset();
          setScenarioId(id);
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4">
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-oceanic-border pb-4">
        <div>
          <span className="text-[11px] font-semibold tracking-wider text-oceanic-secondary uppercase">
            {messages.practice.activeScenario}
          </span>
          <h1 className="font-heading text-2xl font-bold text-oceanic-imperial sm:text-3xl">
            {messages.scenarios[scenarioId].title}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded text-xs"
            onClick={() => {
              void live.stop();
              conversation.reset();
              setScenarioId(null);
            }}
          >
            {messages.practice.switchScenario}
          </Button>
          {turns.length > 0 ? (
            <Button
              variant="default"
              size="sm"
              className="rounded text-xs"
              disabled={finishing || status === "thinking"}
              onClick={async () => {
                setFinishing(true);
                if (live.status !== "off") {
                  await live.stop();
                  // shortcut: the worker saves the last exchange as the call closes. Upgrade it
                  // to waiting for a worker signal if a last turn goes missing.
                  await new Promise((resolve) => setTimeout(resolve, 1500));
                }
                const id = await conversation.finish();
                if (id) {
                  router.push(`/history/${id}`);
                } else {
                  setFinishing(false);
                  setScenarioId(null);
                }
              }}
            >
              {finishing ? messages.practice.finishing : messages.practice.finish}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Transcript Box (Level 0/Subtle) */}
      <div
        ref={transcriptRef}
        className="flex min-h-96 flex-1 flex-col overflow-y-auto rounded-lg border border-oceanic-border bg-oceanic-subtle p-5 shadow-inner"
        aria-live="polite"
      >
        <Transcript turns={turns} interim={live.interim || interim} messages={messages} />
      </div>

      <ConversationControls
        conversation={conversation}
        messages={messages}
        liveVoice={{ live, scenarioId, ...liveVoice }}
      />
    </div>
  );
}
