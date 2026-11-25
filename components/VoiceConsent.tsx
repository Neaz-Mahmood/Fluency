"use client";

import { useState, useTransition } from "react";

import { updateVoiceConsent } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import type { Messages } from "@/lib/messages";

export function VoiceConsent({ given, messages }: { given: boolean; messages: Messages }) {
  const [current, setCurrent] = useState(given);
  const [hasError, setHasError] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    setHasError(false);
    startTransition(async () => {
      const next = !current;
      const result = await updateVoiceConsent(next);
      if (result.status === "ok") {
        setCurrent(next);
      } else {
        setHasError(true);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-oceanic-muted">{messages.voiceConsent.body}</p>
      <p className="text-sm font-medium text-oceanic-imperial">
        {current ? messages.voiceConsent.given : messages.voiceConsent.notGiven}
      </p>
      {hasError ? (
        <p role="alert" className="text-sm font-medium text-oceanic-error">
          {messages.voiceConsent.error}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          variant={current ? "outline" : "default"}
          disabled={isPending}
          onClick={handleToggle}
        >
          {isPending
            ? messages.voiceConsent.saving
            : current
              ? messages.voiceConsent.withdraw
              : messages.voiceConsent.agree}
        </Button>
      </div>
    </div>
  );
}
