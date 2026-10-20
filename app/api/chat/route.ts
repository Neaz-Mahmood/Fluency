import { after } from "next/server";

import { streamClaudeReply } from "@/lib/anthropic";
import { parseChatRequest } from "@/lib/chat-request";
import { getDb } from "@/lib/db";
import type { LearnerProfile, Session } from "@/lib/db/schema";
import { streamGoogleReply } from "@/lib/google";
import { getLearner } from "@/lib/learner";
import { getSystemPrompt } from "@/lib/prompts";
import { resolveProvider } from "@/lib/provider";
import { providerErrorResponse, toProviderError } from "@/lib/provider-errors";
import { startReply, type StartedReply } from "@/lib/reply-stream";
import { resolveSession, saveExchange } from "@/lib/sessions";

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

  let learner: LearnerProfile;
  try {
    learner = await getLearner();
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

  let started: StartedReply;
  try {
    started = await startReply(reply);
  } catch (error) {
    const providerError = toProviderError(error);
    console.error("The AI provider did not start a reply.", providerError);
    const { status, message } = providerErrorResponse(providerError);
    return Response.json({ error: message }, { status });
  }

  let session: Session;
  try {
    session = await resolveSession(getDb(), {
      learnerId: learner.learnerId,
      scenarioId: parsed.scenarioId,
      sessionId: parsed.sessionId,
    });
  } catch (error) {
    reply.abort();
    console.error("Could not load the session.", error);
    return Response.json(
      { error: "Fluency can't load your profile right now. Try again in a moment." },
      { status: 503 },
    );
  }

  // Resolves with whatever was streamed once the reply ends: completed, failed or cancelled.
  let replyText = started.first;
  let finishReply: (text: string) => void = () => undefined;
  const replyDone = new Promise<string>((resolve) => {
    finishReply = resolve;
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(started.first));
        for await (const chunk of started.rest) {
          replyText += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (error) {
        console.error("The AI reply stopped early.", toProviderError(error));
        try {
          controller.error(error);
        } catch {
          // Already cancelled by the client.
        }
      } finally {
        finishReply(replyText);
      }
    },
    cancel() {
      reply.abort();
      finishReply(replyText);
    },
  });

  const userText = parsed.messages[parsed.messages.length - 1]!.content;
  after(async () => {
    try {
      await saveExchange(getDb(), {
        sessionId: session.sessionId,
        userText,
        inputMode: parsed.inputMode ?? null,
        replyText: await replyDone,
      });
    } catch (error) {
      console.error("Could not save the conversation turn.", error);
    }
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Session-Id": session.sessionId,
    },
  });
}
