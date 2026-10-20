import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { ChatTurn } from "@/lib/chat-request";

export const CLAUDE_MODELS = {
  conversation: "claude-sonnet-5-5",
  feedback: "claude-opus-5-5",
} as const;

export type TextReply = {
  abort: () => void;
  text: AsyncIterable<string>;
};

export function streamClaudeReply(options: {
  apiKey: string;
  system: string;
  messages: ChatTurn[];
}): TextReply {
  const client = new Anthropic({ apiKey: options.apiKey });
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
