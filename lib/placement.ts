// The learner answers at most this many times; then finishPlacement scores the chat.
export const PLACEMENT_MAX_ANSWERS = 6;

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

export const ASSESSMENT_PROMPT = `You estimate an English learner's level from a short placement chat. Each learner line is marked (voice) or (typed).

Return only a JSON object, no other text: {"cefr_speaking": "<level>", "cefr_writing": "<level>"} where each level is one of A1, A2, B1, B2, C1, C2.

Base cefr_speaking on (voice) lines and cefr_writing on (typed) lines. If there are no lines of one kind, use the other kind for both. Judge range, accuracy and fluency as described by the CEFR. Very short answers, or answers mostly in another language, mean A1. When unsure between two levels, choose the lower one.`;

export function formatPlacementTranscript(
  turns: { role: "user" | "assistant"; content: string; inputMode: "voice" | "typed" | null }[],
): string {
  return turns
    .map((turn) => {
      if (turn.role === "assistant") {
        return `Partner: ${turn.content}`;
      }
      const mode = turn.inputMode === "voice" ? "voice" : "typed";
      return `Learner (${mode}): ${turn.content}`;
    })
    .join("\n");
}

export function parseAssessment(text: string): { speaking: CefrLevel; writing: CefrLevel } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const speaking = record.cefr_speaking;
    const writing = record.cefr_writing;
    if (
      typeof speaking === "string" &&
      typeof writing === "string" &&
      (CEFR_LEVELS as readonly string[]).includes(speaking) &&
      (CEFR_LEVELS as readonly string[]).includes(writing)
    ) {
      return { speaking: speaking as CefrLevel, writing: writing as CefrLevel };
    }
    return null;
  } catch {
    return null;
  }
}
