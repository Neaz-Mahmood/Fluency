import "server-only";

import type { ChatTurn } from "@/lib/chat-request";
import type { TextReply } from "@/lib/anthropic";

const GOOGLE_MODEL = "gemini-3.8-flash";

type GeminiPart = { text?: string; thought?: boolean };
type GeminiChunk = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
};

function textFromChunk(payload: GeminiChunk): string {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function textFromSseLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return "";
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return "";
  return textFromChunk(JSON.parse(data) as GeminiChunk);
}

async function* readSse(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Google returned an empty stream.");

  const decoder = new TextDecoder();
  let buffer = "";

  const emit = function* (block: string) {
    const lines = block.split("\n");
    const remainder = lines.pop() ?? "";
    for (const line of lines) {
      const text = textFromSseLine(line);
      if (text) yield text;
    }
    return remainder;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = yield* emit(buffer);
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const text = textFromSseLine(buffer);
    if (text) yield text;
  }
}

async function googleFailure(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const body = JSON.parse(raw) as { error?: { message?: string } };
    if (body.error?.message) return `Google could not reply: ${body.error.message}`;
  } catch {
    // The body was not JSON.
  }
  return `Google could not reply (${response.status}).`;
}

export function streamGoogleReply(options: {
  apiKey: string;
  system: string;
  messages: ChatTurn[];
}): TextReply {
  const controller = new AbortController();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:streamGenerateContent?alt=sse`;

  return {
    abort: () => controller.abort(),
    text: (async function* () {
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": options.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: options.system }] },
          contents: options.messages.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
          generationConfig: { maxOutputTokens: 1500 },
        }),
      });

      if (!response.ok) throw new Error(await googleFailure(response));
      yield* readSse(response);
    })(),
  };
}
