import { isUuid } from "@/lib/learner-id";
import { isScenarioId, type ScenarioId } from "@/lib/scenarios";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type InputMode = "voice" | "typed";

type ChatRequestBase = {
  message: string;
  // The session from a previous reply's X-Session-Id header. Absent on the first turn.
  sessionId?: string;
  // How the learner produced the message.
  inputMode?: InputMode;
};

// One new learner turn. The history comes from the saved session, never from the client.
export type ChatRequest =
  | (ChatRequestBase & { mode: "conversation"; scenarioId: ScenarioId })
  | (ChatRequestBase & { mode: "placement" });

const MAX_TURNS = 40;
const MAX_CHARS = 2000;

export function parseChatRequest(body: unknown): ChatRequest | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be an object." };
  }

  const record = body as Record<string, unknown>;
  if (record.mode === "placement") {
    if (record.scenarioId !== undefined) {
      return { error: "Placement does not take a scenario." };
    }
  } else if (record.mode !== undefined && record.mode !== "conversation") {
    return { error: "Mode must be conversation or placement." };
  } else if (typeof record.scenarioId !== "string" || !isScenarioId(record.scenarioId)) {
    return { error: "Choose a scenario before sending a message." };
  }

  const { sessionId, inputMode } = record;
  if (sessionId !== undefined && !isUuid(sessionId)) {
    return { error: "The session id is not valid. Start a new conversation." };
  }
  if (inputMode !== undefined && inputMode !== "voice" && inputMode !== "typed") {
    return { error: "Input mode must be voice or typed." };
  }

  if (typeof record.message !== "string") {
    return { error: "Message must be text." };
  }
  const message = record.message.trim();
  if (!message) {
    return { error: "Message cannot be empty." };
  }
  if (message.length > MAX_CHARS) {
    return { error: "A message is too long." };
  }

  if (record.mode === "placement") {
    return {
      mode: "placement",
      message,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(inputMode !== undefined ? { inputMode: inputMode as InputMode } : {}),
    };
  }

  return {
    mode: "conversation",
    scenarioId: record.scenarioId as ScenarioId,
    message,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(inputMode !== undefined ? { inputMode: inputMode as InputMode } : {}),
  };
}

// The conversation to send to the provider: the saved turns plus the new message.
// Saved turns can repeat a role (a reply that failed before any text saves only the
// learner's turn), so consecutive turns from the same speaker are joined.
export function buildHistory(
  saved: readonly ChatTurn[],
  message: string,
): ChatTurn[] | { error: string } {
  const history: ChatTurn[] = [];
  for (const turn of [...saved, { role: "user" as const, content: message }]) {
    const previous = history[history.length - 1];
    if (previous?.role === turn.role) previous.content += `\n\n${turn.content}`;
    else history.push({ role: turn.role, content: turn.content });
  }

  if (history.length > MAX_TURNS) {
    return { error: "This conversation is too long. Start a new one." };
  }
  return history;
}
