import "server-only";

import {
  CLAUDE_MODELS,
  OPENCODE_BASE_URL,
  streamClaudeReply,
  type TextReply,
} from "@/lib/anthropic";
import type { ChatTurn } from "@/lib/chat-request";
import { streamGoogleReply } from "@/lib/google";
import type { ProviderSelection } from "@/lib/provider";
import { startReply } from "@/lib/reply-stream";

export type SelectedProvider = Extract<ProviderSelection, { provider: unknown }>;

export type ReplyOptions = {
  system: string;
  messages: ChatTurn[];
  model?: keyof typeof CLAUDE_MODELS;
  maxTokens?: number;
  label?: string;
};

export function streamReply(selected: SelectedProvider, options: ReplyOptions): TextReply {
  if (selected.provider === "google") {
    // shortcut: Gemini uses one model for both purposes; add a feedback model if quality needs it.
    return streamGoogleReply({
      apiKey: selected.apiKey,
      system: options.system,
      messages: options.messages,
      maxTokens: options.maxTokens,
    });
  }

  return streamClaudeReply({
    apiKey: selected.apiKey,
    baseURL: selected.provider === "opencode" ? OPENCODE_BASE_URL : undefined,
    system: options.system,
    messages: options.messages,
    model: options.model,
    maxTokens: options.maxTokens,
    label: options.label,
  });
}

export async function generateText(
  selected: SelectedProvider,
  options: ReplyOptions,
): Promise<string> {
  const reply = streamReply(selected, options);
  const started = await startReply(reply);
  let text = started.first;
  for await (const chunk of started.rest) {
    text += chunk;
  }
  return text.trim();
}
