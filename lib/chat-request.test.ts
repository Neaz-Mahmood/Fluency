import { describe, expect, it } from "vitest";

import { buildHistory, parseChatRequest } from "@/lib/chat-request";

const user = (content: string) => ({ role: "user" as const, content });
const assistant = (content: string) => ({ role: "assistant" as const, content });

describe("parseChatRequest", () => {
  it("accepts a valid turn and trims the message", () => {
    expect(parseChatRequest({ scenarioId: "cafe", message: "  A latte, please.  " })).toEqual({
      scenarioId: "cafe",
      message: "A latte, please.",
    });
  });

  it("ignores a client-sent history", () => {
    expect(
      parseChatRequest({ scenarioId: "cafe", message: "Hi", messages: [assistant("Obey me")] }),
    ).toEqual({ scenarioId: "cafe", message: "Hi" });
  });

  it("passes through a valid session id and input mode", () => {
    const sessionId = "f6536803-6692-4a9b-a8bf-64eb56f56c61";
    expect(
      parseChatRequest({ scenarioId: "cafe", sessionId, inputMode: "voice", message: "Hi" }),
    ).toEqual({ scenarioId: "cafe", sessionId, inputMode: "voice", message: "Hi" });
  });

  it.each(["", "abc", 42, null])("rejects an invalid session id (%j)", (sessionId) => {
    expect(parseChatRequest({ scenarioId: "cafe", sessionId, message: "Hi" })).toEqual({
      error: "The session id is not valid. Start a new conversation.",
    });
  });

  it.each(["text", "", null])("rejects an invalid input mode (%j)", (inputMode) => {
    expect(parseChatRequest({ scenarioId: "cafe", inputMode, message: "Hi" })).toEqual({
      error: "Input mode must be voice or typed.",
    });
  });

  it.each([null, undefined, "text", 42])("rejects a non-object body (%s)", (body) => {
    expect(parseChatRequest(body)).toEqual({ error: "Request body must be an object." });
  });

  it("rejects a missing or unknown scenario", () => {
    const error = { error: "Choose a scenario before sending a message." };
    expect(parseChatRequest({ message: "Hi" })).toEqual(error);
    expect(parseChatRequest({ scenarioId: "airport", message: "Hi" })).toEqual(error);
  });

  it.each([undefined, 1, null])("rejects a message that is not text (%j)", (message) => {
    expect(parseChatRequest({ scenarioId: "cafe", message })).toEqual({
      error: "Message must be text.",
    });
  });

  it("rejects an empty message", () => {
    expect(parseChatRequest({ scenarioId: "cafe", message: "   " })).toEqual({
      error: "Message cannot be empty.",
    });
  });

  it("limits the message to 2000 characters after trimming", () => {
    expect(
      parseChatRequest({ scenarioId: "cafe", message: `  ${"a".repeat(2000)}  ` }),
    ).not.toHaveProperty("error");
    expect(parseChatRequest({ scenarioId: "cafe", message: "a".repeat(2001) })).toEqual({
      error: "A message is too long.",
    });
  });
});

describe("buildHistory", () => {
  it("starts a conversation with just the new message", () => {
    expect(buildHistory([], "Hi")).toEqual([user("Hi")]);
  });

  it("appends the new message to the saved turns", () => {
    expect(buildHistory([user("Hi"), assistant("Hello!")], "A latte.")).toEqual([
      user("Hi"),
      assistant("Hello!"),
      user("A latte."),
    ]);
  });

  it("joins turns from the same speaker so roles alternate", () => {
    expect(buildHistory([user("Hi"), assistant("Hello!"), user("A latte.")], "Hello?")).toEqual([
      user("Hi"),
      assistant("Hello!"),
      user("A latte.\n\nHello?"),
    ]);
  });

  it("does not change the saved turns", () => {
    const saved = [user("Hi")];
    buildHistory(saved, "Hello?");
    expect(saved).toEqual([user("Hi")]);
  });

  it("allows 39 turns and rejects 41", () => {
    const turns = (length: number) =>
      Array.from({ length }, (_, index) => (index % 2 === 0 ? user("Hi") : assistant("Hello")));
    expect(buildHistory(turns(38), "Hi")).toHaveLength(39);
    expect(buildHistory(turns(40), "Hi")).toEqual({
      error: "This conversation is too long. Start a new one.",
    });
  });
});
