import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLAUDE_MODELS,
  OPENCODE_BASE_URL,
  streamClaudeReply,
  type TextReply,
} from "@/lib/anthropic";
import type { ChatTurn } from "@/lib/chat-request";
import { streamGoogleReply } from "@/lib/google";
import { generateText, streamReply } from "@/lib/ai";

vi.mock("@/lib/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/anthropic")>();
  return {
    ...actual,
    streamClaudeReply: vi.fn(),
  };
});

vi.mock("@/lib/google", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google")>();
  return {
    ...actual,
    streamGoogleReply: vi.fn(),
  };
});

function fakeReply(chunks: AsyncIterable<string> = from([])): TextReply {
  const abort = vi.fn();
  return { abort, text: chunks };
}

async function* from(values: string[]) {
  for (const value of values) {
    yield value;
  }
}

describe("ai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(streamGoogleReply).mockReturnValue(fakeReply());
    vi.mocked(streamClaudeReply).mockReturnValue(fakeReply());
  });

  describe("streamReply", () => {
    it("calls streamGoogleReply when google provider is selected", () => {
      const messages: ChatTurn[] = [{ role: "user", content: "Hello" }];
      streamReply(
        { provider: "google", apiKey: "google-test-key" },
        { system: "system prompt", messages, maxTokens: 1000 },
      );

      expect(streamGoogleReply).toHaveBeenCalledWith({
        apiKey: "google-test-key",
        system: "system prompt",
        messages,
        maxTokens: 1000,
      });
      expect(streamClaudeReply).not.toHaveBeenCalled();
    });

    it("passes OPENCODE_BASE_URL to streamClaudeReply when opencode is selected", () => {
      expect(OPENCODE_BASE_URL).toBe("https://opencode.ai/inference/anthropic");

      const messages: ChatTurn[] = [{ role: "user", content: "Hello" }];
      streamReply(
        { provider: "opencode", apiKey: "opencode-test-key" },
        { system: "system prompt", messages },
      );

      expect(streamClaudeReply).toHaveBeenCalledWith({
        apiKey: "opencode-test-key",
        baseURL: OPENCODE_BASE_URL,
        system: "system prompt",
        messages,
        model: undefined,
        maxTokens: undefined,
      });
      expect(streamGoogleReply).not.toHaveBeenCalled();
    });

    it("passes model 'feedback' through to streamClaudeReply", () => {
      expect(CLAUDE_MODELS.feedback).toBe("claude-opus-5-5");

      const messages: ChatTurn[] = [{ role: "user", content: "Hello" }];
      streamReply(
        { provider: "claude", apiKey: "claude-test-key" },
        { system: "system prompt", messages, model: "feedback" },
      );

      expect(streamClaudeReply).toHaveBeenCalledWith({
        apiKey: "claude-test-key",
        baseURL: undefined,
        system: "system prompt",
        messages,
        model: "feedback",
        maxTokens: undefined,
      });
      expect(streamGoogleReply).not.toHaveBeenCalled();
    });
  });

  describe("generateText", () => {
    it("joins chunks and returns trimmed text", async () => {
      vi.mocked(streamClaudeReply).mockReturnValue(fakeReply(from(["Hel", "lo ", "there "])));

      const text = await generateText(
        { provider: "claude", apiKey: "claude-test-key" },
        { system: "system prompt", messages: [] },
      );

      expect(text).toBe("Hello there");
    });

    it("rejects when the stream throws before the first chunk", async () => {
      async function* boom(): AsyncGenerator<string> {
        throw new Error("stream error before first chunk");
      }
      vi.mocked(streamClaudeReply).mockReturnValue(fakeReply(boom()));

      await expect(
        generateText(
          { provider: "claude", apiKey: "claude-test-key" },
          { system: "system prompt", messages: [] },
        ),
      ).rejects.toMatchObject({
        name: "ProviderError",
        message: "stream error before first chunk",
      });
    });
  });
});
