import { describe, expect, it } from "vitest";

import { ExchangeCollector, parseJobMetadata } from "./job";

describe("parseJobMetadata", () => {
  const validLearnerId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
  const validSessionId = "c9a646d3-9c61-4cd7-9f59-e1b32dca5273";

  it("parses valid metadata with sessionId", () => {
    const raw = JSON.stringify({
      learnerId: validLearnerId,
      scenarioId: "cafe",
      sessionId: validSessionId,
    });
    const parsed = parseJobMetadata(raw);
    expect(parsed).toEqual({
      learnerId: validLearnerId,
      scenarioId: "cafe",
      sessionId: validSessionId,
    });
  });

  it("parses valid metadata without sessionId", () => {
    const raw = JSON.stringify({
      learnerId: validLearnerId,
      scenarioId: "free-chat",
    });
    const parsed = parseJobMetadata(raw);
    expect(parsed).toEqual({
      learnerId: validLearnerId,
      scenarioId: "free-chat",
      sessionId: null,
    });
  });

  it("parses valid metadata with explicit null sessionId", () => {
    const raw = JSON.stringify({
      learnerId: validLearnerId,
      scenarioId: "job-interview",
      sessionId: null,
    });
    const parsed = parseJobMetadata(raw);
    expect(parsed).toEqual({
      learnerId: validLearnerId,
      scenarioId: "job-interview",
      sessionId: null,
    });
  });

  it("returns error for malformed JSON", () => {
    const parsed = parseJobMetadata("{not-valid-json");
    expect(parsed).toEqual({ error: "Job metadata is not valid JSON." });
  });

  it("returns error for undefined metadata", () => {
    const parsed = parseJobMetadata(undefined);
    expect(parsed).toEqual({ error: "Job metadata is missing or empty." });
  });

  it("returns error for empty string metadata", () => {
    const parsed = parseJobMetadata("   ");
    expect(parsed).toEqual({ error: "Job metadata is missing or empty." });
  });

  it("returns error for non-object JSON", () => {
    const parsed = parseJobMetadata(JSON.stringify(["not", "an", "object"]));
    expect(parsed).toEqual({ error: "Job metadata must be an object." });
  });

  it("returns error for bad learnerId", () => {
    const raw = JSON.stringify({
      learnerId: "not-a-uuid",
      scenarioId: "cafe",
    });
    const parsed = parseJobMetadata(raw);
    expect(parsed).toEqual({ error: "Job metadata has no valid learnerId." });
  });

  it("returns error for unknown scenario", () => {
    const raw = JSON.stringify({
      learnerId: validLearnerId,
      scenarioId: "space-station",
    });
    const parsed = parseJobMetadata(raw);
    expect(parsed).toEqual({ error: "Job metadata has no valid scenarioId." });
  });

  it("returns error for bad sessionId", () => {
    const raw = JSON.stringify({
      learnerId: validLearnerId,
      scenarioId: "cafe",
      sessionId: "invalid-session-uuid",
    });
    const parsed = parseJobMetadata(raw);
    expect(parsed).toEqual({ error: "Job metadata has no valid sessionId." });
  });
});

describe("ExchangeCollector", () => {
  it("creates an exchange from user then assistant with firstTokenMs rounded", () => {
    const collector = new ExchangeCollector();
    const res1 = collector.add({ role: "user", text: "Hello" });
    expect(res1).toBeNull();

    const res2 = collector.add({
      role: "assistant",
      text: "Hi there!",
      llmTtftSeconds: 0.4264,
    });
    expect(res2).toEqual({
      userText: "Hello",
      replyText: "Hi there!",
      firstTokenMs: 426,
    });
  });

  it("joins two user messages before a reply with a space", () => {
    const collector = new ExchangeCollector();
    expect(collector.add({ role: "user", text: "I want tea" })).toBeNull();
    expect(collector.add({ role: "user", text: "and a muffin please." })).toBeNull();

    const exchange = collector.add({
      role: "assistant",
      text: "Coming right up!",
      llmTtftSeconds: 0.5,
    });
    expect(exchange).toEqual({
      userText: "I want tea and a muffin please.",
      replyText: "Coming right up!",
      firstTokenMs: 500,
    });
  });

  it("returns null for an assistant message with no preceding user text", () => {
    const collector = new ExchangeCollector();
    const exchange = collector.add({
      role: "assistant",
      text: "Speaking without user input",
      llmTtftSeconds: 0.3,
    });
    expect(exchange).toBeNull();
  });

  it("ignores empty user text", () => {
    const collector = new ExchangeCollector();
    expect(collector.add({ role: "user", text: "   " })).toBeNull();
    expect(collector.add({ role: "user", text: "Hello!" })).toBeNull();

    const exchange = collector.add({
      role: "assistant",
      text: "Hi!",
      llmTtftSeconds: 0.2,
    });
    expect(exchange).toEqual({
      userText: "Hello!",
      replyText: "Hi!",
      firstTokenMs: 200,
    });
  });

  it("ignores non-user and non-assistant roles", () => {
    const collector = new ExchangeCollector();
    expect(collector.add({ role: "system", text: "System prompt" })).toBeNull();
    expect(collector.add({ role: "developer", text: "Developer instruction" })).toBeNull();
    expect(collector.flush()).toBeNull();
  });

  it("sets firstTokenMs to null when llmTtftSeconds is missing or NaN", () => {
    const collector = new ExchangeCollector();
    collector.add({ role: "user", text: "Turn 1" });
    const ex1 = collector.add({ role: "assistant", text: "Reply 1" });
    expect(ex1?.firstTokenMs).toBeNull();

    collector.add({ role: "user", text: "Turn 2" });
    const ex2 = collector.add({ role: "assistant", text: "Reply 2", llmTtftSeconds: Number.NaN });
    expect(ex2?.firstTokenMs).toBeNull();

    collector.add({ role: "user", text: "Turn 3" });
    const ex3 = collector.add({
      role: "assistant",
      text: "Reply 3",
      llmTtftSeconds: Number.POSITIVE_INFINITY,
    });
    expect(ex3?.firstTokenMs).toBeNull();
  });

  it("flush() returns buffered user text if any and clears buffer", () => {
    const collector = new ExchangeCollector();
    expect(collector.flush()).toBeNull();

    collector.add({ role: "user", text: "I spoke but left before reply." });
    const flushed = collector.flush();
    expect(flushed).toEqual({
      userText: "I spoke but left before reply.",
      replyText: "",
      firstTokenMs: null,
    });

    expect(collector.flush()).toBeNull();
  });
});
