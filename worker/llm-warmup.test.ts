import { llm } from "@livekit/agents";
import { describe, expect, it, vi } from "vitest";

import { warmPromptCache, warmupContext, type ChatModel } from "./llm-warmup";

function fakeModel(chunks: unknown[], fail = false) {
  const close = vi.fn();
  const model = {
    chat: vi.fn(() => {
      if (fail) throw new Error("gateway down");
      return {
        close,
        async *[Symbol.asyncIterator]() {
          yield* chunks;
        },
      };
    }),
  } as unknown as ChatModel;
  return { model, close };
}

describe("warmupContext", () => {
  it("puts the instructions first, then the history, then a placeholder turn", () => {
    const history = llm.ChatContext.empty();
    history.addMessage({ role: "user", content: "Hi" });
    history.addMessage({ role: "assistant", content: "Hello! Tea?" });

    const ctx = warmupContext("You are Fluency.", history);
    expect(
      ctx.items.map((item) => (item.type === "message" ? [item.role, item.textContent] : [])),
    ).toEqual([
      ["system", "You are Fluency."],
      ["user", "Hi"],
      ["assistant", "Hello! Tea?"],
      ["user", "Hello."],
    ]);
  });
});

describe("warmPromptCache", () => {
  it("stops at the first chunk and closes the stream", async () => {
    const { model, close } = fakeModel(["a", "b", "c"]);
    expect(await warmPromptCache(model, llm.ChatContext.empty())).toBeTypeOf("number");
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns null instead of throwing when the call fails", async () => {
    const { model } = fakeModel([], true);
    expect(await warmPromptCache(model, llm.ChatContext.empty())).toBeNull();
  });
});
