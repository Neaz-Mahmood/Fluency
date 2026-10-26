"use client";

import { useState, useTransition } from "react";
import { AudioLines } from "lucide-react";

import { updateVoiceConsent } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import type { useLiveVoice } from "@/hooks/useLiveVoice";
import type { Messages } from "@/lib/messages";
import type { ScenarioId } from "@/lib/scenarios";

export function LiveVoiceControls({
  live,
  consented: initialConsented,
  scenarioId,
  getSessionId,
  beforeStart,
  messages,
}: {
  live: ReturnType<typeof useLiveVoice>;
  consented: boolean;
  scenarioId: ScenarioId;
  getSessionId: () => string | null;
  beforeStart: () => void;
  messages: Messages;
}) {
  const [consented, setConsented] = useState(initialConsented);
  const [askingConsent, setAskingConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function begin() {
    beforeStart();
    const result = await live.start({ scenarioId, sessionId: getSessionId() });
    if (result === "needs-consent") {
      setConsented(false);
      setAskingConsent(true);
    }
  }

  const isLive =
    live.status === "listening" || live.status === "thinking" || live.status === "speaking";

  return (
    <div className="flex flex-col gap-3">
      {live.error ? (
        <p className="rounded border border-oceanic-error/20 bg-oceanic-error-container px-3 py-2 text-xs font-medium text-oceanic-on-error-container">
          {live.error}
        </p>
      ) : null}

      {askingConsent ? (
        <div className="flex flex-col gap-3 rounded-lg border border-oceanic-border bg-oceanic-subtle/50 p-4">
          <h3 className="text-sm font-semibold text-oceanic-imperial">
            {messages.liveVoice.consentTitle}
          </h3>
          <p className="text-xs leading-relaxed text-oceanic-muted">{messages.voiceConsent.body}</p>
          {consentError ? (
            <p role="alert" className="text-xs font-medium text-oceanic-error">
              {messages.voiceConsent.error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={() => {
                setConsentError(false);
                startTransition(async () => {
                  const res = await updateVoiceConsent(true);
                  if (res.status === "ok") {
                    setConsented(true);
                    setAskingConsent(false);
                    void begin();
                  } else {
                    setConsentError(true);
                  }
                });
              }}
            >
              {isPending ? messages.voiceConsent.saving : messages.liveVoice.agreeAndStart}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setAskingConsent(false)}
            >
              {messages.liveVoice.notNow}
            </Button>
          </div>
        </div>
      ) : null}

      {!askingConsent && live.status === "off" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            className="h-10 gap-2 rounded px-4 font-semibold text-white bg-oceanic-imperial hover:bg-oceanic-persian active:bg-oceanic-ocean shadow-[0_2px_8px_-2px_rgba(3,37,108,0.2)]"
            onClick={() => {
              if (consented) {
                void begin();
              } else {
                setAskingConsent(true);
              }
            }}
          >
            <AudioLines className="size-4 text-oceanic-surge" />
            {messages.liveVoice.start}
          </Button>
          <span className="text-xs text-oceanic-muted">{messages.liveVoice.hint}</span>
        </div>
      ) : null}

      {!askingConsent && live.status === "connecting" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled
            className="h-10 gap-2 rounded px-4 font-semibold text-white bg-oceanic-imperial opacity-70"
          >
            <AudioLines className="size-4 text-oceanic-surge animate-pulse" />
            {messages.liveVoice.connecting}
          </Button>
        </div>
      ) : null}

      {!askingConsent && isLive ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-10 gap-2 rounded px-4 border-oceanic-border text-oceanic-imperial hover:bg-oceanic-subtle"
            onClick={() => void live.stop()}
          >
            {messages.liveVoice.stop}
          </Button>
          {live.remainingSeconds !== null && live.remainingSeconds <= 60 ? (
            <span className="text-xs text-oceanic-muted">{messages.liveVoice.lastMinute}</span>
          ) : null}
        </div>
      ) : null}

      {live.needsAudioTap ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 rounded px-4 border-oceanic-surge text-oceanic-imperial hover:bg-oceanic-subtle"
            onClick={live.resumeAudio}
          >
            {messages.liveVoice.tapToHear}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
