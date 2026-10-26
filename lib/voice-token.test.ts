import { describe, expect, it } from "vitest";

import {
  createVoiceToken,
  LEARNER_IDENTITY,
  liveVoiceConfig,
  parseVoiceTokenRequest,
  voiceRoomName,
} from "@/lib/voice-token";
import { AGENT_NAME, parseJobMetadata, type VoiceJob } from "@/worker/job";

describe("liveVoiceConfig", () => {
  it("returns config when all environment variables are set", () => {
    const env = {
      LIVEKIT_URL: "https://fluency.livekit.cloud",
      LIVEKIT_API_KEY: "API_KEY_123",
      LIVEKIT_API_SECRET: "API_SECRET_456",
    };
    expect(liveVoiceConfig(env)).toEqual({
      url: "https://fluency.livekit.cloud",
      apiKey: "API_KEY_123",
      apiSecret: "API_SECRET_456",
    });
  });

  it("returns null when one environment variable is missing", () => {
    const env = {
      LIVEKIT_URL: "https://fluency.livekit.cloud",
      LIVEKIT_API_KEY: "API_KEY_123",
    };
    expect(liveVoiceConfig(env)).toBeNull();
  });

  it("returns null when one environment variable is empty", () => {
    const env = {
      LIVEKIT_URL: "https://fluency.livekit.cloud",
      LIVEKIT_API_KEY: "   ",
      LIVEKIT_API_SECRET: "API_SECRET_456",
    };
    expect(liveVoiceConfig(env)).toBeNull();
  });
});

describe("parseVoiceTokenRequest", () => {
  const validUuid = "123e4567-e89b-12d3-a456-426614174000";

  it("parses valid request without a session", () => {
    const result = parseVoiceTokenRequest({ scenarioId: "cafe" });
    expect(result).toEqual({ scenarioId: "cafe", sessionId: null });
  });

  it("parses valid request with a uuid session", () => {
    const result = parseVoiceTokenRequest({ scenarioId: "cafe", sessionId: validUuid });
    expect(result).toEqual({ scenarioId: "cafe", sessionId: validUuid });
  });

  it("parses valid request with sessionId: null", () => {
    const result = parseVoiceTokenRequest({ scenarioId: "cafe", sessionId: null });
    expect(result).toEqual({ scenarioId: "cafe", sessionId: null });
  });

  it("returns an error for a missing scenario", () => {
    const result = parseVoiceTokenRequest({});
    expect(result).toEqual({ error: "Choose a scenario before starting live voice." });
  });

  it("returns an error for an unknown scenario", () => {
    const result = parseVoiceTokenRequest({ scenarioId: "nonexistent-scenario" });
    expect(result).toEqual({ error: "Choose a scenario before starting live voice." });
  });

  it("returns an error for a bad session id", () => {
    const result = parseVoiceTokenRequest({ scenarioId: "cafe", sessionId: "not-a-uuid" });
    expect(result).toEqual({
      error: "The session id is not valid. Start a new conversation.",
    });
  });

  it("returns an error for a non-object", () => {
    expect(parseVoiceTokenRequest(null)).toEqual({
      error: "Choose a scenario before starting live voice.",
    });
    expect(parseVoiceTokenRequest("string")).toEqual({
      error: "Choose a scenario before starting live voice.",
    });
    expect(parseVoiceTokenRequest([1, 2, 3])).toEqual({
      error: "Choose a scenario before starting live voice.",
    });
  });
});

describe("voiceRoomName", () => {
  it("starts with voice- and is unique across two calls", () => {
    const name1 = voiceRoomName();
    const name2 = voiceRoomName();
    expect(name1).toMatch(/^voice-[0-9a-f-]{36}$/);
    expect(name2).toMatch(/^voice-[0-9a-f-]{36}$/);
    expect(name1).not.toBe(name2);
  });
});

describe("createVoiceToken", () => {
  it("creates a signed JWT token adhering to the contract with worker", async () => {
    const config = {
      apiKey: "fake-api-key",
      apiSecret: "fake-secret-at-least-32-characters-long!!",
    };
    const room = voiceRoomName();
    const job: VoiceJob = {
      learnerId: "123e4567-e89b-12d3-a456-426614174000",
      scenarioId: "cafe",
      sessionId: "987fcdeb-51a2-43f7-9876-ba0987654321",
    };

    const jwt = await createVoiceToken(config, room, job);
    expect(typeof jwt).toBe("string");

    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

    expect(payload.sub).toBe(LEARNER_IDENTITY);
    expect(payload.video).toBeDefined();
    expect(payload.video.room).toBe(room);
    expect(payload.video.roomJoin).toBe(true);
    expect(payload.video.canPublishSources).toEqual(["microphone"]);
    expect(payload.video.canPublishData).toBe(false);

    expect(payload.roomConfig?.agents?.[0]?.agentName).toBe(AGENT_NAME);

    const verifiedJob = parseJobMetadata(payload.roomConfig.agents[0].metadata);
    expect(verifiedJob).toEqual(job);
  });
});
