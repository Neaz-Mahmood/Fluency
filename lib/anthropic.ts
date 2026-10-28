import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { ChatTurn } from "@/lib/chat-request";

export const CLAUDE_MODELS = {
  conversation: "claude-sonnet-5-5",
  feedback: "claude-opus-5-5",
  // Candidate for the Phase 4 voice loop; compared in scripts/voice/ttft.ts.
  live: "claude-haiku-5-5",
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
  model?: keyof typeof CLAUDE_MODELS;
  maxTokens?: number;
  // Names the call in the usage log line, e.g. "chat" or "feedback".
  label?: string;
}): TextReply {
  const client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseURL });
  const model = CLAUDE_MODELS[options.model ?? "conversation"];
  const stream = client.messages.stream({
    model,
    max_tokens: options.maxTokens ?? 1500,
    system: options.system,
    messages: options.messages,
    output_config: { effort: "low" },
  });

  return {
    abort: () => stream.abort(),
    text: (async function* () {
      let usage: Anthropic.Usage | null = null;
      let outputTokens = 0;
      let stopReason: string | null = null;
      for await (const event of stream) {
        if (event.type === "message_start") {
          usage = event.message.usage;
        } else if (event.type === "message_delta") {
          outputTokens = event.usage.output_tokens;
          stopReason = event.delta.stop_reason;
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
      // One line per call, so cost per feature can be measured from the logs.
      console.log(
        JSON.stringify({
          event: "claude_usage",
          label: options.label ?? null,
          model,
          input_tokens: usage?.input_tokens ?? null,
          cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? null,
          cache_read_input_tokens: usage?.cache_read_input_tokens ?? null,
          output_tokens: outputTokens,
          stop_reason: stopReason,
        }),
      );
    })(),
  };
}
