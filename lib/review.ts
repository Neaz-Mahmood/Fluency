export const BLANK = "_____";

export const REVIEW_SENTENCE_PROMPT = `You write one new practice sentence for an English learner's flashcard review.

Use the target item exactly as written, once, in a short everyday sentence (at most 15 words) at the learner's level. Make it different from the example sentence. Do not explain anything.

Return only a JSON object, no other text: {"sentence": "..."}`;

export function buildReviewInput(
  card: {
    targetItem: string;
    nativeTranslation: string;
    sourceContextSentence: string | null;
  },
  level: string | null,
): string {
  return [
    `Target item: ${card.targetItem}`,
    `Meaning: ${card.nativeTranslation}`,
    `Example sentence: ${card.sourceContextSentence ?? "(none)"}`,
    `Learner level: ${level ?? "unknown"}`,
  ].join("\n");
}

// Saved phrases often end in "..." or "?" ("Could I have...?"), which a new sentence won't repeat.
const EDGE_PUNCTUATION = /^[\s.…?!,;:]+|[\s.…?!,;:]+$/g;

// Explanations often quote the answer ("…তাই 'I like'"); hide it so the prompt doesn't give it away.
export function maskItem(text: string, targetItem: string): string {
  const item = targetItem.replace(EDGE_PUNCTUATION, "");
  if (!item) {
    return text;
  }
  const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "gi"), BLANK);
}

export function blankSentence(sentence: string, targetItem: string): string | null {
  const item = targetItem.replace(EDGE_PUNCTUATION, "");
  if (!item) {
    return null;
  }
  const index = sentence.toLowerCase().indexOf(item.toLowerCase());
  if (index === -1) {
    return null;
  }
  return sentence.slice(0, index) + BLANK + sentence.slice(index + item.length);
}

export function parseReviewSentence(text: string, targetItem: string): string | null {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const sentence = (parsed as Record<string, unknown>).sentence;
    if (typeof sentence !== "string") {
      return null;
    }
    const trimmed = sentence.trim();
    if (trimmed.length === 0 || sentence.length > 300) {
      return null;
    }
    return blankSentence(trimmed, targetItem);
  } catch {
    return null;
  }
}
