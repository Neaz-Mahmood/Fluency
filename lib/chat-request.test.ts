import { describe, expect, it } from "vitest";

import { parseChatRequest } from "@/lib/chat-request";

const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });

describe("parseChatRequest", () => {
  it("accepts a valid conversation and trims content", () => {
    expect(
      parseChatRequest({
        scenarioId: "cafe",
        messages: [user("  Hi  "), assistant("Hello!"), user("A latte, please.")],
      }),
    ).toEqual({
      scenarioId: "cafe",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
        { role: "user", content: "A latte, please." },
      ],
    });
  });

  it("drops fields other than role and content", () => {
    const parsed = parseChatRequest({
      scenarioId: "free-chat",
      messages: [{ role: "user", content: "Hi", id: "x" }],
    });
    expect(parsed).toEqual({
      scenarioId: "free-chat",
      messages: [{ role: "user", content: "Hi" }],
    });
  });

  it.each([null, undefined, "text", 42])("rejects a non-object body (%s)", (body) => {
    expect(parseChatRequest(body)).toEqual({ error: "Request body must be an object." });
  });

  it("rejects a missing or unknown scenario", () => {
    const error = { error: "Choose a scenario before sending a message." };
    expect(parseChatRequest({ messages: [user("Hi")] })).toEqual(error);
    expect(parseChatRequest({ scenarioId: "airport", messages: [user("Hi")] })).toEqual(error);
  });

  it("rejects missing or empty messages", () => {
    const error = { error: "Send at least one message." };
    expect(parseChatRequest({ scenarioId: "cafe" })).toEqual(error);
    expect(parseChatRequest({ scenarioId: "cafe", messages: [] })).toEqual(error);
  });

  it("rejects more than 40 messages", () => {
    const messages = Array.from({ length: 41 }, (_, index) =>
      index % 2 === 0 ? user("Hi") : assistant("Hello"),
    );
    expect(parseChatRequest({ scenarioId: "cafe", messages })).toEqual({
      error: "This conversation is too long. Start a new one.",
    });
  });

  it("accepts 39 messages, the longest conversation that starts and ends with the user", () => {
    const messages = Array.from({ length: 39 }, (_, index) =>
      index % 2 === 0 ? user("Hi") : assistant("Hello"),
    );
    expect(parseChatRequest({ scenarioId: "cafe", messages })).not.toHaveProperty("error");
  });

  it("rejects malformed messages", () => {
    expect(parseChatRequest({ scenarioId: "cafe", messages: [null] })).toEqual({
      error: "Each message must include a role and content.",
    });
    expect(
      parseChatRequest({ scenarioId: "cafe", messages: [{ role: "system", content: "x" }] }),
    ).toEqual({
      error: "Message roles must be user or assistant.",
    });
    expect(
      parseChatRequest({ scenarioId: "cafe", messages: [{ role: "user", content: 1 }] }),
    ).toEqual({
      error: "Message content must be text.",
    });
    expect(parseChatRequest({ scenarioId: "cafe", messages: [user("   ")] })).toEqual({
      error: "Message content cannot be empty.",
    });
  });

  it("limits content to 2000 characters after trimming", () => {
    expect(
      parseChatRequest({ scenarioId: "cafe", messages: [user(`  ${"a".repeat(2000)}  `)] }),
    ).not.toHaveProperty("error");
    expect(parseChatRequest({ scenarioId: "cafe", messages: [user("a".repeat(2001))] })).toEqual({
      error: "A message is too long.",
    });
  });

  it("requires turns to alternate", () => {
    expect(
      parseChatRequest({ scenarioId: "cafe", messages: [user("Hi"), user("Hello?")] }),
    ).toEqual({
      error: "Messages must alternate between you and the partner.",
    });
  });

  it("requires the first and last message to be from the user", () => {
    const error = { error: "The latest message must be from you." };
    expect(parseChatRequest({ scenarioId: "cafe", messages: [assistant("Hello")] })).toEqual(error);
    expect(
      parseChatRequest({ scenarioId: "cafe", messages: [user("Hi"), assistant("Hello")] }),
    ).toEqual(error);
  });
});
