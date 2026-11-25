import { llm } from "@livekit/agents";

// The model server caches each prompt's prefix. The first request with a new system prompt is
// computed from scratch: in FLU-75 the first two turns of a session took 0.8–1.6 s to the first
// token, the rest mostly 340–500 ms. So the worker sends the session's real prompt once while the
// room connects, reads the first chunk and stops, and the learner's first turn finds it cached.

export type ChatModel = Pick<llm.LLM, "chat">;

// The chat context the agent will send, up to a placeholder for the learner's first turn: the
// instructions as the system message, then the earlier turns.
export function warmupContext(instructions: string, history: llm.ChatContext): llm.ChatContext {
  const ctx = llm.ChatContext.empty();
  ctx.addMessage({ role: "system", content: instructions });
  for (const item of history.items) {
    if (item.type === "message") ctx.addMessage({ role: item.role, content: item.content });
  }
  ctx.addMessage({ role: "user", content: "Hello." });
  return ctx;
}

// Resolves with ms to the first chunk, or null if the call failed; it never throws, since a
// failed warm-up only means the first turn is slower.
export async function warmPromptCache(
  model: ChatModel,
  chatCtx: llm.ChatContext,
): Promise<number | null> {
  const startedAt = Date.now();
  let stream: llm.LLMStream | undefined;
  try {
    stream = model.chat({ chatCtx });
    for await (const chunk of stream) {
      void chunk;
      return Date.now() - startedAt;
    }
    return Date.now() - startedAt;
  } catch {
    return null;
  } finally {
    stream?.close();
  }
}
