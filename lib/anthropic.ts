import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { ChatTurn } from "@/lib/chat-request";

export const CLAUDE_MODELS = {
  conversation: "claude-sonnet-5-5",
  feedback: "claude-opus-5-5",
} as const;

// OpenCode serves the same Claude models through an Anthropic-compatible Messages API.
export const OPENCODE_BASE_URL = "https://opencode.ai/inference/anthropic";

export type TextReply = {
  abort: () => void;
  text: AsyncIterable<string>;
};

export function streamClaudeReply(options: {
  apiKey: string;
  baseURL?: string;
  system: string;
  messages: ChatTurn[];
}): TextReply {
  const client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseURL });
  const stream = client.messages.stream({
    model: CLAUDE_MODELS.conversation,
    max_tokens: 1500,
    system: options.system,
    messages: options.messages,
    output_config: { effort: "low" },
  });

  return {
    abort: () => stream.abort(),
    text: (async function* () {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
    })(),
  };
}
