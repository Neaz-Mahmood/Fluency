import "server-only";

import { AccessToken, RoomAgentDispatch, RoomConfiguration, TrackSource } from "livekit-server-sdk";

import type { Db } from "@/lib/db";
import type { LearnerProfile } from "@/lib/db/schema";
import { isUuid } from "@/lib/learner-id";
import { isScenarioId, type ScenarioId } from "@/lib/scenarios";
import { findOpenSession } from "@/lib/sessions";
import { remainingVoiceSeconds } from "@/lib/voice-quota";
import { agentName, type VoiceJob } from "@/worker/job";

export function liveVoiceConfig(
  env: Record<string, string | undefined> = process.env,
): { url: string; apiKey: string; apiSecret: string; agentName: string } | null {
  const url = env.LIVEKIT_URL?.trim();
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();
  const name = agentName(env);
  if (!url || !apiKey || !apiSecret || !name) {
    return null;
  }
  return { url, apiKey, apiSecret, agentName: name };
}

export function parseVoiceTokenRequest(
  body: unknown,
): { scenarioId: ScenarioId; sessionId: string | null } | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Choose a scenario before starting live voice." };
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.scenarioId !== "string" || !isScenarioId(obj.scenarioId)) {
    return { error: "Choose a scenario before starting live voice." };
  }

  let sessionId: string | null = null;
  if (obj.sessionId !== undefined && obj.sessionId !== null) {
    if (!isUuid(obj.sessionId)) {
      return { error: "The session id is not valid. Start a new conversation." };
    }
    sessionId = obj.sessionId;
  }

  return {
    scenarioId: obj.scenarioId,
    sessionId,
  };
}

export type VoiceRefusal = "consent" | "quota" | "session";

export const VOICE_REFUSALS: Record<VoiceRefusal, { status: number; error: string }> = {
  consent: { status: 403, error: "Agree to live voice in Settings first." },
  quota: { status: 429, error: "Today's live voice time is used up." },
  session: { status: 404, error: "That conversation has ended. Start a new one." },
};

export async function checkVoiceAccess(
  db: Db,
  learner: LearnerProfile,
  request: { scenarioId: ScenarioId; sessionId: string | null },
  now: Date,
): Promise<{ remainingSeconds: number } | { refusal: VoiceRefusal }> {
  if (learner.voiceConsentAt === null) {
    return { refusal: "consent" };
  }

  const remainingSeconds = await remainingVoiceSeconds(db, learner.learnerId, now);
  if (remainingSeconds <= 0) {
    return { refusal: "quota" };
  }

  if (request.sessionId) {
    const existing = await findOpenSession(db, {
      learnerId: learner.learnerId,
      sessionId: request.sessionId,
      scenarioId: request.scenarioId,
      mode: "conversation",
    });
    if (!existing) {
      return { refusal: "session" };
    }
  }

  return { remainingSeconds };
}

export function voiceRoomName(): string {
  return `voice-${crypto.randomUUID()}`;
}

// Keeps the learner id out of LiveKit's participant list, and there is one learner per room.
export const LEARNER_IDENTITY = "learner";

export async function createVoiceToken(
  config: { apiKey: string; apiSecret: string; agentName: string },
  room: string,
  job: VoiceJob,
): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: LEARNER_IDENTITY,
    ttl: "10m",
  });

  token.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: true,
    canPublishData: false,
  });

  // The worker trusts this metadata because our server signs it into the token. The agent is
  // dispatched when the learner joins.
  token.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: config.agentName,
        metadata: JSON.stringify(job),
      }),
    ],
  });

  return token.toJwt();
}
