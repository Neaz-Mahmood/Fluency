"use client";

import { useState, useTransition } from "react";

import { saveRecapCard, type SaveTarget } from "@/app/history/actions";
import { Button } from "@/components/ui/button";
import type { Messages } from "@/lib/messages";

export function SaveCardButton({
  sessionId,
  target,
  saved,
  messages,
}: {
  sessionId: string;
  target: SaveTarget;
  saved: boolean;
  messages: Messages;
}) {
  const [isSaved, setIsSaved] = useState(saved);
  const [hasError, setHasError] = useState(false);
  const [isPending, startTransition] = useTransition();

  const effectivelySaved = saved || isSaved;

  const label = isPending
    ? messages.recap.saving
    : effectivelySaved
      ? messages.recap.saved
      : hasError
        ? messages.recap.saveFailed
        : messages.recap.save;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="rounded text-xs"
      disabled={effectivelySaved || isPending}
      onClick={() => {
        startTransition(async () => {
          setHasError(false);
          const result = await saveRecapCard(sessionId, target);
          if (result.status === "saved") {
            setIsSaved(true);
          } else {
            setHasError(true);
          }
        });
      }}
    >
      {label}
    </Button>
  );
}
