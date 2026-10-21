"use client";

import { useEffect, useRef, useState } from "react";

import { ConversationControls } from "@/components/ConversationControls";
import { ScenarioPicker } from "@/components/ScenarioPicker";
import { Transcript } from "@/components/Transcript";
import { Button } from "@/components/ui/button";
import { useConversation, type SavedConversation } from "@/hooks/useConversation";
import type { Messages } from "@/lib/messages";
import { SCENARIOS, type ScenarioId } from "@/lib/scenarios";

export function Conversation({
  saved,
  messages,
}: {
  saved: SavedConversation | null;
  messages: Messages;
}) {
  const [scenarioId, setScenarioId] = useState<ScenarioId | null>(saved?.scenarioId ?? null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const conversation = useConversation({
    target: scenarioId ? { scenarioId } : null,
    saved,
    messages,
  });
  const { turns, status, interim } = conversation;

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [turns, interim, status]);

  const scenario = SCENARIOS.find((item) => item.id === scenarioId);

  if (!scenarioId || !scenario) {
    return (
      <ScenarioPicker
        messages={messages}
        onSelect={(id) => {
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
        <Button
          variant="outline"
          size="sm"
          className="rounded text-xs"
          onClick={() => {
            conversation.reset();
            setScenarioId(null);
          }}
        >
          {messages.practice.switchScenario}
        </Button>
      </div>

      {/* Transcript Box (Level 0/Subtle) */}
      <div
        ref={transcriptRef}
        className="flex min-h-96 flex-1 flex-col overflow-y-auto rounded-lg border border-oceanic-border bg-oceanic-subtle p-5 shadow-inner"
        aria-live="polite"
      >
        <Transcript turns={turns} interim={interim} messages={messages} />
      </div>

      <ConversationControls conversation={conversation} messages={messages} />
    </div>
  );
}
