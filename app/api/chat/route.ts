import { streamClaudeReply } from "@/lib/anthropic";
import { parseChatRequest } from "@/lib/chat-request";
import { streamGoogleReply } from "@/lib/google";
import { getLearner } from "@/lib/learner";
import { getSystemPrompt } from "@/lib/prompts";
import { resolveProvider } from "@/lib/provider";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = parseChatRequest(body);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const selected = resolveProvider();
  if ("error" in selected) {
    return Response.json({ error: selected.error }, { status: 503 });
  }

  try {
    await getLearner();
  } catch (error) {
    console.error("Could not load the learner.", error);
    return Response.json(
      { error: "Fluency can't load your profile right now. Try again in a moment." },
      { status: 503 },
    );
  }

  const reply =
    selected.provider === "claude"
      ? streamClaudeReply({
          apiKey: selected.apiKey,
          system: getSystemPrompt(parsed.scenarioId),
          messages: parsed.messages,
        })
      : streamGoogleReply({
          apiKey: selected.apiKey,
          system: getSystemPrompt(parsed.scenarioId),
          messages: parsed.messages,
        });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of reply.text) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      reply.abort();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
