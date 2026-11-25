import { after } from "next/server";

import { streamReply } from "@/lib/ai";
import { dueCardItems } from "@/lib/cards";
import { buildHistory, parseChatRequest, type ChatTurn } from "@/lib/chat-request";
import { getDb } from "@/lib/db";
import type { LearnerProfile, Session } from "@/lib/db/schema";
import { activeErrorExamples } from "@/lib/feedback-store";
import { getLearner } from "@/lib/learner";
import { PLACEMENT_MAX_ANSWERS } from "@/lib/placement";
import {
  getPlacementPrompt,
  getSystemPrompt,
  NO_TARGETS,
  type PracticeTargets,
} from "@/lib/prompts";
import { resolveProvider } from "@/lib/provider";
import { providerErrorResponse, toProviderError } from "@/lib/provider-errors";
import { startReply, type StartedReply } from "@/lib/reply-stream";
import { findOpenSession, loadTurns, saveExchange, startSession } from "@/lib/sessions";

export async function POST(request: Request) {
  const receivedAt = performance.now();
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
  let targets: PracticeTargets = NO_TARGETS;
  let existing: Session | null = null;
  let savedTurns: ChatTurn[] = [];
  try {
    learner = await getLearner();
    if (parsed.mode === "conversation") {
      const [items, mistakes] = await Promise.all([
        dueCardItems(getDb(), learner.learnerId, new Date(), 2),
        activeErrorExamples(getDb(), learner.learnerId, 2),
      ]);
      targets = { items, mistakes };
    }
    if (parsed.sessionId) {
      existing = await findOpenSession(
        getDb(),
        parsed.mode === "conversation"
          ? {
              learnerId: learner.learnerId,
              sessionId: parsed.sessionId,
              scenarioId: parsed.scenarioId,
              mode: "conversation",
            }
          : {
              learnerId: learner.learnerId,
              sessionId: parsed.sessionId,
              mode: "placement",
            },
      );
    }
    if (existing) savedTurns = await loadTurns(getDb(), existing.sessionId);
  } catch (error) {
    console.error("Could not load the learner or session.", error);
    return Response.json(
      { error: "Fluency can't load your profile right now. Try again in a moment." },
      { status: 503 },
    );
  }

  const answers = savedTurns.filter((turn) => turn.role === "user").length + 1;
  if (parsed.mode === "placement" && answers > PLACEMENT_MAX_ANSWERS) {
    return Response.json({ error: "Placement is finished." }, { status: 409 });
  }

  const messages = buildHistory(savedTurns, parsed.message);
  if ("error" in messages) {
    return Response.json({ error: messages.error }, { status: 400 });
  }

  const system =
    parsed.mode === "placement"
      ? getPlacementPrompt(answers)
      : getSystemPrompt(parsed.scenarioId, learner, targets);

  const reply = streamReply(selected, {
    system,
    messages,
    label: parsed.mode,
    cacheConversation: true,
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

  const firstTokenMs = Math.round(performance.now() - receivedAt);

  // Created only once the reply has started, so a failed first turn leaves no session.
  let session: Session;
  try {
    session =
      existing ??
      (await startSession(getDb(), {
        learnerId: learner.learnerId,
        mode: parsed.mode,
        scenarioId: parsed.mode === "conversation" ? parsed.scenarioId : null,
      }));
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

  const replyTurnId = crypto.randomUUID();

  after(async () => {
    try {
      await saveExchange(getDb(), {
        sessionId: session.sessionId,
        userText: parsed.message,
        inputMode: parsed.inputMode ?? null,
        replyText: await replyDone,
        replyTurnId,
        firstTokenMs,
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
      "X-Reply-Id": replyTurnId,
    },
  });
}
