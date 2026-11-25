// Hard character limit ensuring the tutor note stays well under 250 tokens in future prompts.
export const SUMMARY_MAX_CHARS = 700;

// Conservative token ratio: English averages ~4 chars/token, so 700 chars ≈ 233 tokens at most.
export const CHARS_PER_TOKEN_ESTIMATE = 3;

export const SUMMARY_PROMPT = `You write a short private note about an English learner for their next practice conversation. The tutor reads it before talking to them.

Write plain text, at most 100 words, no lists, no markdown. Include: their level and native language if known; their interests and things from their life worth asking about again; what they do well; and at most three recurring mistakes, each with a short example of what they said. Merge the previous note with this session and drop details that no longer matter. Do not invent anything that is not in the note or the transcript. Refer to the learner as "the learner" or "they"; never guess their gender.`;

export function buildSummaryInput(
  learner: {
    cefrSpeaking: string | null;
    nativeLanguage: string | null;
    compactTutorSummary: string;
  },
  turns: { role: "user" | "assistant"; content: string }[],
): string {
  const previousNote = learner.compactTutorSummary.trim() || "(none)";
  const transcript = turns
    .map((turn) => `${turn.role === "user" ? "Learner" : "Partner"}: ${turn.content}`)
    .join("\n");

  return `Level: ${learner.cefrSpeaking ?? "unknown"}
Native language: ${learner.nativeLanguage ?? "unknown"}

Previous note:
${previousNote}

Transcript:
${transcript}`;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export function capSummary(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SUMMARY_MAX_CHARS) {
    return collapsed;
  }

  const slice = collapsed.slice(0, SUMMARY_MAX_CHARS);
  const sentenceEnd = Math.max(
    slice.lastIndexOf("."),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?"),
  );
  if (sentenceEnd !== -1) {
    return slice.slice(0, sentenceEnd + 1);
  }

  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace !== -1) {
    return slice.slice(0, lastSpace);
  }

  return slice;
}
