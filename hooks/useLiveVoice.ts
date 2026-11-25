"use client";

import { useEffect, useRef, useState } from "react";

import type { Turn } from "@/hooks/useConversation";
import { recordLiveVoiceLatency } from "@/app/practice/actions";
import {
  AGENT_STATE_ATTRIBUTE,
  audioStatsLine,
  createLatencyTracker,
  END_REASON_ATTRIBUTE,
  LATENCY_TICK_MS,
  liveEndMessage,
  liveStatus,
  readAudioStats,
  remainingFromAttributes,
  REPLY_TURN_ID_ATTRIBUTE,
  rmsDbfs,
  sessionIdFromAttributes,
  TRANSCRIPTION_TOPIC,
  transcriptUpdate,
  type AudioStatsSample,
  type LatencyTracker,
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
  remainingSeconds: number | null;
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
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  const statusRef = useRef<LiveVoiceStatus>("off");
  const onTurnRef = useRef(options.onTurn);
  const onSessionIdRef = useRef(options.onSessionId);
  const messagesRef = useRef(options.messages);
  const endReasonRef = useRef<string | null>(null);

  const roomRef = useRef<import("livekit-client").Room | null>(null);
  const attachedElementsRef = useRef<Set<HTMLMediaElement>>(new Set());
  const joinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const agentAnalyserRef = useRef<AnalyserNode | null>(null);
  const latencyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackerRef = useRef<LatencyTracker | null>(null);
  const pendingLatencyRef = useRef<number | null>(null);
  const agentTrackRef = useRef<import("livekit-client").RemoteTrack | null>(null);
  const lastStatsRef = useRef<AudioStatsSample | null>(null);

  useEffect(() => {
    onTurnRef.current = options.onTurn;
  }, [options.onTurn]);

  useEffect(() => {
    onSessionIdRef.current = options.onSessionId;
  }, [options.onSessionId]);

  useEffect(() => {
    messagesRef.current = options.messages;
  }, [options.messages]);

  function closeAudio() {
    if (latencyTimerRef.current !== null) {
      clearInterval(latencyTimerRef.current);
      latencyTimerRef.current = null;
    }
    micAnalyserRef.current = null;
    agentAnalyserRef.current = null;
    trackerRef.current = null;
    pendingLatencyRef.current = null;
    agentTrackRef.current = null;
    lastStatsRef.current = null;
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    if (ctx) {
      void ctx.close().catch(() => {});
    }
  }

  function analyse(track: MediaStreamTrack): AnalyserNode | null {
    const ctx = audioContextRef.current;
    if (!ctx) {
      return null;
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    source.connect(analyser);
    return analyser;
  }

  // Logs the network and buffering behind a timed reply (FLU-72), next to its latency line.
  async function logNetworkStats(room: import("livekit-client").Room) {
    const report = await agentTrackRef.current?.getRTCStatsReport().catch(() => undefined);
    const sample = report ? readAudioStats(report.values()) : null;
    if (!sample) return;
    console.info(audioStatsLine(lastStatsRef.current, sample, room.serverInfo?.region));
    lastStatsRef.current = sample;
  }

  // Safe to call twice. Resolves once the room has disconnected.
  function cleanup(errorMessage: string | null): Promise<void> {
    if (joinTimerRef.current) {
      clearTimeout(joinTimerRef.current);
      joinTimerRef.current = null;
    }

    closeAudio();

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
    setRemainingSeconds(null);
    setError(errorMessage);
    return disconnected;
  }

  useEffect(() => {
    return () => {
      void cleanup(null);
    };
    // cleanup and closeAudio touch only refs and state setters, so the mount-time copy is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    endReasonRef.current = null;

    audioContextRef.current = new AudioContext();
    void audioContextRef.current.resume().catch(() => {});
    trackerRef.current = createLatencyTracker();
    pendingLatencyRef.current = null;

    let response: Response;
    try {
      response = await fetch("/api/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
    } catch {
      closeAudio();
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
      closeAudio();
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
      const data = (await response.json()) as {
        url: string;
        token: string;
        remainingSeconds?: number;
      };
      url = data.url;
      token = data.token;
      if (typeof data.remainingSeconds === "number") {
        setRemainingSeconds(data.remainingSeconds);
      }
    } catch {
      closeAudio();
      statusRef.current = "off";
      setStatus("off");
      setError(messagesRef.current.liveVoice.unavailable);
      return "failed";
    }

    const { Room, RoomEvent, ParticipantKind, Track } = await import("livekit-client");
    // stop() while connecting sets the status back to off.
    if (statusRef.current !== "connecting") {
      closeAudio();
      return "failed";
    }
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
      const agentState = attributes[AGENT_STATE_ATTRIBUTE];
      if (typeof agentState === "string") {
        trackerRef.current?.agentState(agentState);
      }
      const replyTurnId = attributes[REPLY_TURN_ID_ATTRIBUTE];
      if (typeof replyTurnId === "string" && pendingLatencyRef.current !== null) {
        void recordLiveVoiceLatency(replyTurnId, pendingLatencyRef.current);
        pendingLatencyRef.current = null;
      }
      const nextStatus = liveStatus(agentState);
      if (nextStatus !== null) {
        statusRef.current = nextStatus;
        setStatus(nextStatus);
      }
      const sessionId = sessionIdFromAttributes(attributes);
      if (sessionId !== null) {
        onSessionIdRef.current(sessionId);
      }
      const remaining = remainingFromAttributes(attributes);
      if (remaining !== null) {
        setRemainingSeconds(remaining);
      }
      if (attributes[END_REASON_ATTRIBUTE] !== undefined) {
        endReasonRef.current = attributes[END_REASON_ATTRIBUTE];
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
        agentAnalyserRef.current = analyse(track.mediaStreamTrack);
        agentTrackRef.current = track;
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
        void cleanup(liveEndMessage(endReasonRef.current, messagesRef.current.liveVoice));
      }
    });

    // stop() removes the listeners first, so this only fires when the connection drops.
    room.on(
      RoomEvent.Disconnected,
      () => void cleanup(liveEndMessage(endReasonRef.current, messagesRef.current.liveVoice)),
    );

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

    const micTrack = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
      ?.mediaStreamTrack;
    if (micTrack) {
      micAnalyserRef.current = analyse(micTrack);
    }

    const micBuffer = new Float32Array(512);
    const agentBuffer = new Float32Array(512);
    latencyTimerRef.current = setInterval(() => {
      let micDbfs = -100;
      if (micAnalyserRef.current) {
        micAnalyserRef.current.getFloatTimeDomainData(micBuffer);
        micDbfs = rmsDbfs(micBuffer);
      }
      let agentDbfs = -100;
      if (agentAnalyserRef.current) {
        agentAnalyserRef.current.getFloatTimeDomainData(agentBuffer);
        agentDbfs = rmsDbfs(agentBuffer);
      }
      const now = performance.now();
      const ms = trackerRef.current?.tick(now, micDbfs, agentDbfs);
      // Once an end reason is set, the next audio is the quota goodbye, not a reply.
      if (typeof ms === "number" && endReasonRef.current === null) {
        pendingLatencyRef.current = ms;
        // Wall-clock times, to line up with the worker's timeline (FLU-72).
        const audibleAt = Math.round(performance.timeOrigin + now);
        console.info(
          `[voice] speech end → first audio: ${ms} ms (speech end at ${audibleAt - ms}, audible at ${audibleAt})`,
        );
        void logNetworkStats(room);
      }
    }, LATENCY_TICK_MS);

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
    remainingSeconds,
    start,
    stop,
    resumeAudio,
  };
}
