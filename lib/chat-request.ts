import { isScenarioId, type ScenarioId } from "@/lib/scenarios";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

const MAX_TURNS = 40;
const MAX_CHARS = 2000;

export function parseChatRequest(
  body: unknown,
): { scenarioId: ScenarioId; messages: ChatTurn[] } | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be an object." };
  }

  const record = body as Record<string, unknown>;
  if (typeof record.scenarioId !== "string" || !isScenarioId(record.scenarioId)) {
    return { error: "Choose a scenario before sending a message." };
  }

  if (!Array.isArray(record.messages) || record.messages.length === 0) {
    return { error: "Send at least one message." };
  }

  if (record.messages.length > MAX_TURNS) {
    return { error: "This conversation is too long. Start a new one." };
  }

  const messages: ChatTurn[] = [];
  for (const entry of record.messages) {
    if (!entry || typeof entry !== "object") {
      return { error: "Each message must include a role and content." };
    }
    const turn = entry as Record<string, unknown>;
    if (turn.role !== "user" && turn.role !== "assistant") {
      return { error: "Message roles must be user or assistant." };
    }
    if (typeof turn.content !== "string") {
      return { error: "Message content must be text." };
    }
    const content = turn.content.trim();
    if (!content) {
      return { error: "Message content cannot be empty." };
    }
    if (content.length > MAX_CHARS) {
      return { error: "A message is too long." };
    }
    const previous = messages[messages.length - 1];
    if (previous && previous.role === turn.role) {
      return { error: "Messages must alternate between you and the partner." };
    }
    messages.push({ role: turn.role, content });
  }

  if (messages[0]?.role !== "user" || messages[messages.length - 1]?.role !== "user") {
    return { error: "The latest message must be from you." };
  }

  return { scenarioId: record.scenarioId, messages };
}
