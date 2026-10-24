export type FeedbackEdit = { original: string; correction: string; code: string };
export type FeedbackItem = {
  line: number; // 1-based learner line number from buildFeedbackInput
  edits: FeedbackEdit[]; // empty when the line is correct
  minimalCorrection: string; // the line with only the edits applied
  fluencyUpgrade: string | null; // optional, more natural phrasing
  l1Cause: string | null; // likely native-language interference, or null
  explanation: string; // one or two short sentences for the learner
};
export type VocabularyItem = { item: string; meaning: string; example: string };
export type Feedback = { items: FeedbackItem[]; vocabulary: VocabularyItem[] };
export type FeedbackLine = {
  role: "user" | "assistant";
  content: string;
  inputMode: "voice" | "typed" | null;
};
export type ExplanationLanguage = "Bangla" | "English";

// Limits post-session vocabulary items to avoid overwhelming the learner.
export const MAX_VOCABULARY = 5;

// Matches learner_error_patterns.error_code varchar(64) database column.
export const MAX_ERROR_CODE_LENGTH = 64;

// System prompt template for post-session feedback with {language} placeholders.
export const FEEDBACK_PROMPT_TEMPLATE = `You review an English learner's lines from a practice conversation and point out real errors.

Precision matters more than recall. Flag something only if a fluent speaker would agree it is wrong in this context. These are not errors: contractions, short answers, informal or spoken style, sentence fragments that are natural in conversation, and South Asian English that is grammatical. Do not correct capitalization or punctuation. Lines marked (voice) were written by speech recognition, so never correct their spelling either. Most lines have no errors, and that is a good result.

Learner lines are numbered L1, L2, … and marked (voice) or (typed). Partner lines are context only; never correct them.

Return an item only for a learner line that has at least one real error, or that is correct but has a clearly more natural phrasing. Skip every other line. Each item has:
- "line": the line number, without the L
- "edits": the smallest changes that fix real errors, each {"original": an exact substring of the line, "correction": its replacement, "code": an ERRANT code such as R:VERB:TENSE, R:VERB:SVA, M:DET, U:DET, R:PREP, R:NOUN:NUM, R:WO, M:VERB}. Use [] when the line is correct.
- "minimal_correction": the line with only those edits applied, or the line unchanged when edits is []
- "fluency_upgrade": a more natural way to say the same thing, or null. This is optional style advice, never a requirement.
- "l1_interference_cause": one short sentence if the error likely comes from the learner's native language, otherwise null
- "explanation": one or two short, friendly sentences in {language} that explain the fix, or why the upgrade sounds more natural

Also return up to 5 "vocabulary" items: words or phrases from this conversation that would help the learner next time, each {"item": the English word or phrase, "meaning": a short meaning in {language}, "example": one short English sentence using it}. Return [] if nothing is worth saving.

Return only a JSON object, no other text: {"items": [...], "vocabulary": [...]}

Example input:
Partner: What did you do at the weekend?
L1 (voice): I go to my cousin house on Friday.
Partner: Nice. What did you eat?
L2 (voice): We ate biryani and drank tea.
L3 (typed): It was really fun.
L4 (typed): My cousin is engineer in a big company.
L5 (voice): I want to visit again soon.

Example output:
{"items": [{"line": 1, "edits": [{"original": "go", "correction": "went", "code": "R:VERB:TENSE"}, {"original": "cousin house", "correction": "cousin's house", "code": "M:NOUN:POSS"}], "minimal_correction": "I went to my cousin's house on Friday.", "fluency_upgrade": null, "l1_interference_cause": "Bangla often shows past time with a time word instead of changing the verb.", "explanation": "..."}, {"line": 3, "edits": [], "minimal_correction": "It was really fun.", "fluency_upgrade": "It was a lot of fun.", "l1_interference_cause": null, "explanation": "..."}, {"line": 4, "edits": [{"original": "is engineer", "correction": "is an engineer", "code": "M:DET"}], "minimal_correction": "My cousin is an engineer in a big company.", "fluency_upgrade": "My cousin works as an engineer at a big company.", "l1_interference_cause": "Bangla has no articles, so a/an is easy to drop.", "explanation": "..."}], "vocabulary": [{"item": "cousin's house", "meaning": "...", "example": "I stayed at my cousin's house."}]}`;

export function explanationLanguage(learner: {
  nativeLanguage: string | null;
  cefrSpeaking: string | null;
}): ExplanationLanguage {
  // Only A1–A2 explanations use the native language (doc/roadmap.md), and an unplaced learner is treated as a beginner.
  if (
    learner.nativeLanguage === "bn-BD" &&
    (learner.cefrSpeaking === "A1" ||
      learner.cefrSpeaking === "A2" ||
      learner.cefrSpeaking === null)
  ) {
    return "Bangla";
  }
  return "English";
}

export function buildFeedbackSystemPrompt(language: ExplanationLanguage): string {
  return FEEDBACK_PROMPT_TEMPLATE.replaceAll("{language}", language);
}

export function buildFeedbackInput(lines: FeedbackLine[]): {
  input: string;
  learnerLines: string[];
  learnerIndexes: number[];
} {
  const formattedRows: string[] = [];
  const learnerLines: string[] = [];
  const learnerIndexes: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.content.trim() === "") {
      continue;
    }
    const cleanContent = line.content.replace(/[\r\n]+/g, " ").trim();
    if (line.role === "assistant") {
      formattedRows.push(`Partner: ${cleanContent}`);
    } else {
      const learnerIndex = learnerLines.length + 1;
      const mode = line.inputMode ?? "typed";
      formattedRows.push(`L${learnerIndex} (${mode}): ${cleanContent}`);
      learnerLines.push(cleanContent);
      learnerIndexes.push(i);
    }
  }

  return {
    input: formattedRows.join("\n"),
    learnerLines,
    learnerIndexes,
  };
}

export function applyEdits(text: string, edits: FeedbackEdit[]): string {
  let result = text;
  for (const edit of edits) {
    const idx = result.indexOf(edit.original);
    if (idx !== -1) {
      result = result.slice(0, idx) + edit.correction + result.slice(idx + edit.original.length);
    }
  }
  return result;
}

export function parseFeedback(text: string, learnerLines: string[]): Feedback | null {
  let stripped = text.trim();
  if (stripped.startsWith("```json")) {
    stripped = stripped.slice(7);
  } else if (stripped.startsWith("```")) {
    stripped = stripped.slice(3);
  }
  if (stripped.endsWith("```")) {
    stripped = stripped.slice(0, -3);
  }
  stripped = stripped.trim();

  if (stripped.startsWith("[")) {
    return null;
  }

  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const rawItems = Array.isArray(record.items) ? record.items : [];
  const keptLines = new Set<number>();
  const items: FeedbackItem[] = [];

  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      continue;
    }
    const itemObj = rawItem as Record<string, unknown>;
    const rawLine = itemObj.line;
    if (
      typeof rawLine !== "number" ||
      !Number.isInteger(rawLine) ||
      rawLine < 1 ||
      rawLine > learnerLines.length ||
      keptLines.has(rawLine)
    ) {
      continue;
    }

    const rawExplanation = itemObj.explanation;
    if (typeof rawExplanation !== "string" || rawExplanation.trim() === "") {
      continue;
    }
    const explanation = rawExplanation.trim();

    const lineText = learnerLines[rawLine - 1];
    const rawEdits = Array.isArray(itemObj.edits) ? itemObj.edits : [];
    let droppedEdit = false;
    const keptEdits: FeedbackEdit[] = [];

    for (const rawEdit of rawEdits) {
      if (
        rawEdit &&
        typeof rawEdit === "object" &&
        !Array.isArray(rawEdit) &&
        typeof (rawEdit as Record<string, unknown>).original === "string" &&
        typeof (rawEdit as Record<string, unknown>).correction === "string"
      ) {
        const editObj = rawEdit as Record<string, unknown>;
        const original = editObj.original as string;
        const correction = editObj.correction as string;
        if (original.trim() !== "" && original !== correction && lineText.includes(original)) {
          const rawCode = editObj.code;
          const codeStr =
            typeof rawCode === "string" && rawCode.trim() !== "" ? rawCode.trim() : "OTHER";
          const code = codeStr.slice(0, MAX_ERROR_CODE_LENGTH);
          keptEdits.push({ original, correction, code });
          continue;
        }
      }
      droppedEdit = true;
    }

    const rawMinimalCorrection =
      typeof itemObj.minimal_correction === "string"
        ? itemObj.minimal_correction
        : typeof itemObj.minimalCorrection === "string"
          ? itemObj.minimalCorrection
          : null;

    let minimalCorrection: string;
    const hasNonEmptyModelCorrection =
      typeof rawMinimalCorrection === "string" && rawMinimalCorrection.trim() !== "";

    if (hasNonEmptyModelCorrection && !droppedEdit) {
      minimalCorrection = rawMinimalCorrection.trim();
    } else {
      minimalCorrection = keptEdits.length === 0 ? lineText : applyEdits(lineText, keptEdits);
    }

    const rawFluencyUpgrade =
      typeof itemObj.fluency_upgrade === "string"
        ? itemObj.fluency_upgrade
        : typeof itemObj.fluencyUpgrade === "string"
          ? itemObj.fluencyUpgrade
          : null;

    let fluencyUpgrade: string | null = null;
    if (typeof rawFluencyUpgrade === "string" && rawFluencyUpgrade.trim() !== "") {
      const trimmedUpgrade = rawFluencyUpgrade.trim();
      if (trimmedUpgrade !== lineText && trimmedUpgrade !== minimalCorrection) {
        fluencyUpgrade = trimmedUpgrade;
      }
    }

    const rawL1Cause =
      typeof itemObj.l1_interference_cause === "string"
        ? itemObj.l1_interference_cause
        : typeof itemObj.l1Cause === "string"
          ? itemObj.l1Cause
          : null;

    let l1Cause: string | null = null;
    if (typeof rawL1Cause === "string" && rawL1Cause.trim() !== "") {
      l1Cause = rawL1Cause.trim();
    }

    if (keptEdits.length === 0 && fluencyUpgrade === null) {
      continue;
    }

    keptLines.add(rawLine);
    items.push({
      line: rawLine,
      edits: keptEdits,
      minimalCorrection,
      fluencyUpgrade,
      l1Cause,
      explanation,
    });
  }

  const rawVocabulary = Array.isArray(record.vocabulary) ? record.vocabulary : [];
  const vocabulary: VocabularyItem[] = [];
  const seenVocabItems = new Set<string>();

  for (const rawVocab of rawVocabulary) {
    if (!rawVocab || typeof rawVocab !== "object" || Array.isArray(rawVocab)) {
      continue;
    }
    const v = rawVocab as Record<string, unknown>;
    if (
      typeof v.item === "string" &&
      typeof v.meaning === "string" &&
      typeof v.example === "string"
    ) {
      const item = v.item.trim();
      const meaning = v.meaning.trim();
      const example = v.example.trim();

      if (item !== "" && meaning !== "" && example !== "") {
        const lower = item.toLowerCase();
        if (!seenVocabItems.has(lower)) {
          seenVocabItems.add(lower);
          vocabulary.push({ item, meaning, example });
          if (vocabulary.length >= MAX_VOCABULARY) {
            break;
          }
        }
      }
    }
  }

  items.sort((a, b) => a.line - b.line);
  return { items, vocabulary };
}

export function splitSentences(text: string): string[] {
  const paragraphs = text.split(/\r?\n+/);
  const sentences: string[] = [];

  for (const paragraph of paragraphs) {
    const trimmedPara = paragraph.trim();
    if (!trimmedPara) {
      continue;
    }
    const pieces = trimmedPara.split(/(?<=[.!?]+['"’”\)\]\}]*)\s+/);
    for (const piece of pieces) {
      const trimmed = piece.trim();
      if (trimmed) {
        sentences.push(trimmed);
      }
    }
  }

  return sentences;
}
