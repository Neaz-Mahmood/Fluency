"use client";

import { useEffect, useRef, useState } from "react";

import type { Turn } from "@/hooks/useConversation";
import {
  AGENT_STATE_ATTRIBUTE,
  liveStatus,
  sessionIdFromAttributes,
  TRANSCRIPTION_TOPIC,
  transcriptUpdate,
  type LiveVoiceStatus,
} from "@/lib/live-voice";
import type { Messages } from "@/lib/messages";
import type { ScenarioId } from "@/lib/scenarios";

export const AGENT_JOIN_TIMEOUT_MS = 15000;

export function useLiveVoice(options: {
  messages: Messages;
  onTurn: (turn: Turn) => void;
  onSessionId: (sessionId: string) => void;
}): {
  status: LiveVoiceStatus;
  interim: string;
  error: string | null;
  needsAudioTap: boolean;
  start: (target: {
    scenarioId: ScenarioId;
    sessionId: string | null;
  }) => Promise<"started" | "needs-consent" | "failed">;
  stop: () => Promise<void>;
  resumeAudio: () => void;
} {
  const [status, setStatus] = useState<LiveVoiceStatus>("off");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsAudioTap, setNeedsAudioTap] = useState(false);

  const statusRef = useRef<LiveVoiceStatus>("off");
  const onTurnRef = useRef(options.onTurn);
  const onSessionIdRef = useRef(options.onSessionId);
  const messagesRef = useRef(options.messages);

  const roomRef = useRef<import("livekit-client").Room | null>(null);
  const attachedElementsRef = useRef<Set<HTMLMediaElement>>(new Set());
  const joinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onTurnRef.current = options.onTurn;
  }, [options.onTurn]);

  useEffect(() => {
    onSessionIdRef.current = options.onSessionId;
  }, [options.onSessionId]);

  useEffect(() => {
    messagesRef.current = options.messages;
  }, [options.messages]);

  // Safe to call twice. Resolves once the room has disconnected.
  function cleanup(errorMessage: string | null): Promise<void> {
    if (joinTimerRef.current) {
      clearTimeout(joinTimerRef.current);
      joinTimerRef.current = null;
    }

    // Listeners go first, so this room's late events can't clean up a newer session.
    const currentRoom = roomRef.current;
    roomRef.current = null;
    currentRoom?.removeAllListeners();
    const disconnected = currentRoom ? currentRoom.disconnect() : Promise.resolve();

    attachedElementsRef.current.forEach((element) => {
      element.remove();
    });
    attachedElementsRef.current.clear();

    statusRef.current = "off";
    setStatus("off");
    setInterim("");
    setNeedsAudioTap(false);
    setError(errorMessage);
    return disconnected;
  }

  useEffect(() => {
    return () => {
      void cleanup(null);
    };
  }, []);

  async function start(target: {
    scenarioId: ScenarioId;
    sessionId: string | null;
  }): Promise<"started" | "needs-consent" | "failed"> {
    if (statusRef.current !== "off") {
      return "failed";
    }

    statusRef.current = "connecting";
    setStatus("connecting");
    setError(null);
    setInterim("");

    let response: Response;
    try {
      response = await fetch("/api/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
    } catch {
      statusRef.current = "off";
      setStatus("off");
      setError(messagesRef.current.liveVoice.unavailable);
      return "failed";
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      statusRef.current = "off";
      setStatus("off");
      if (payload?.code === "consent") {
        return "needs-consent";
      }
      if (payload?.code === "quota") {
        setError(messagesRef.current.liveVoice.quotaUsed);
      } else {
        setError(messagesRef.current.liveVoice.unavailable);
      }
      return "failed";
    }

    let url: string;
    let token: string;
    try {
      const data = (await response.json()) as { url: string; token: string };
      url = data.url;
      token = data.token;
    } catch {
      statusRef.current = "off";
      setStatus("off");
      setError(messagesRef.current.liveVoice.unavailable);
      return "failed";
    }

    const { Room, RoomEvent, ParticipantKind, Track } = await import("livekit-client");
    // stop() while connecting sets the status back to off.
    if (statusRef.current !== "connecting") return "failed";
    const room = new Room();
    // False once stop() or a failure has cleaned this room up.
    const current = () => roomRef.current === room;
    roomRef.current = room;

    room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, (reader, participantInfo) => {
      void (async () => {
        let text = "";
        try {
          for await (const chunk of reader) {
            text += chunk;
            const update = transcriptUpdate({
              senderIdentity: participantInfo.identity,
              localIdentity: room.localParticipant.identity,
              attributes: reader.info.attributes ?? {},
              streamId: reader.info.id,
              text,
            });
            if (update) {
              if (update.kind === "interim") {
                setInterim(update.text);
              } else if (update.kind === "turn") {
                onTurnRef.current(update.turn);
                if (update.turn.role === "user") {
                  setInterim("");
                }
              }
            }
          }
        } catch {
          // A stream cut off by a disconnect is not an error
        }
      })();
    });

    room.on(
      RoomEvent.ParticipantAttributesChanged,
      (changed: Record<string, string>, participant) => {
        if (participant.kind === ParticipantKind.AGENT) followAgent(changed);
      },
    );

    let agentJoined = false;
    function followAgent(attributes: Record<string, string>) {
      const nextStatus = liveStatus(attributes[AGENT_STATE_ATTRIBUTE]);
      if (nextStatus !== null) {
        statusRef.current = nextStatus;
        setStatus(nextStatus);
      }
      const sessionId = sessionIdFromAttributes(attributes);
      if (sessionId !== null) {
        onSessionIdRef.current(sessionId);
      }
    }
    function agentArrived(attributes: Record<string, string>) {
      agentJoined = true;
      if (joinTimerRef.current) {
        clearTimeout(joinTimerRef.current);
        joinTimerRef.current = null;
      }
      followAgent(attributes);
    }

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (participant.kind === ParticipantKind.AGENT) agentArrived(participant.attributes);
    });

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        const element = track.attach();
        attachedElementsRef.current.add(element);
        document.body.appendChild(element);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((element) => {
        attachedElementsRef.current.delete(element);
        element.remove();
      });
    });

    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      setNeedsAudioTap(!room.canPlaybackAudio);
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (participant.kind === ParticipantKind.AGENT) {
        void cleanup(messagesRef.current.liveVoice.dropped);
      }
    });

    // stop() removes the listeners first, so this only fires when the connection drops.
    room.on(RoomEvent.Disconnected, () => void cleanup(messagesRef.current.liveVoice.dropped));

    try {
      await room.connect(url, token);
    } catch {
      if (current()) void cleanup(messagesRef.current.liveVoice.unavailable);
      return "failed";
    }
    if (!current()) return "failed";

    try {
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (error: unknown) {
      const isMicDenied =
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        (error as { name: string }).name === "NotAllowedError";
      if (!current()) return "failed";
      void cleanup(
        isMicDenied
          ? messagesRef.current.liveVoice.micDenied
          : messagesRef.current.liveVoice.unavailable,
      );
      return "failed";
    }
    if (!current()) return "failed";

    // The agent may have joined before connect returned.
    for (const participant of room.remoteParticipants.values()) {
      if (participant.kind === ParticipantKind.AGENT) agentArrived(participant.attributes);
    }

    if (!agentJoined) {
      joinTimerRef.current = setTimeout(() => {
        void cleanup(messagesRef.current.liveVoice.unavailable);
      }, AGENT_JOIN_TIMEOUT_MS);
    }

    setNeedsAudioTap(!room.canPlaybackAudio);

    return "started";
  }

  async function stop(): Promise<void> {
    await cleanup(null);
  }

  function resumeAudio() {
    void roomRef.current?.startAudio();
  }

  return {
    status,
    interim,
    error,
    needsAudioTap,
    start,
    stop,
    resumeAudio,
  };
}
