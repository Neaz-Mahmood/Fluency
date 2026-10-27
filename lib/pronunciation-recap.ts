import type { ExplanationLanguage } from "@/lib/feedback";
import { catalogCodeFor, findPattern } from "@/lib/pronunciation-patterns";
import type { PhonemeMismatch, WeakWord } from "@/lib/pronunciation-score";

// One scored learner turn, with its transcript (the learner's words, used to spot proper nouns).
export type ScoredTurn = {
  audioMs: number;
  accuracy: number | null;
  fluency: number | null;
  prosody: number | null;
  weakWords: WeakWord[];
  mismatches: PhonemeMismatch[];
  transcript: string;
};

export type PatternFinding = {
  code: string; // a catalog code from lib/pronunciation-patterns.ts
  count: number; // mismatches mapped to it in this session
  words: string[]; // distinct lowercased words, in order of first appearance, at most 5
  meanScore: number; // mean phoneme score of those mismatches, rounded
};

export type SessionPronunciation = {
  scoredTurns: number;
  audioMs: number;
  // Audio-weighted means over the turns that have the score, rounded; null if none has it.
  accuracy: number | null;
  fluency: number | null;
  prosody: number | null;
  patterns: PatternFinding[]; // most frequent first; ties by lower meanScore first
  weakWords: { word: string; score: number }[]; // see below
};

export type PronunciationTip = { focus: string; tip: string };

export function isLikelyProperNoun(word: string, transcript: string): boolean {
  const target = word.replace(/^[^a-zA-Z']+|[^a-zA-Z']+$/g, "");
  if (!target || target === "I" || target === "i") {
    return false;
  }
  const targetLower = target.toLowerCase();

  const wordRegex = /[a-zA-Z']+/g;
  let match: RegExpExecArray | null;
  let foundAny = false;
  let hasNonSentenceStartCapitalized = false;

  while ((match = wordRegex.exec(transcript)) !== null) {
    const raw = match[0];
    const stripped = raw.replace(/^'+|'+$/g, "");
    if (!stripped) continue;

    if (stripped.toLowerCase() === targetLower) {
      foundAny = true;
      if (stripped[0] >= "a" && stripped[0] <= "z") {
        return false;
      }

      const startOffset = match.index + raw.indexOf(stripped);
      const prefix = transcript.slice(0, startOffset);
      const isSentenceStart = prefix.trim() === "" || /[.!?]['"”’]*\s+$/.test(prefix);

      if (!isSentenceStart && stripped[0] >= "A" && stripped[0] <= "Z") {
        hasNonSentenceStartCapitalized = true;
      }
    }
  }

  if (!foundAny) {
    return false;
  }

  return hasNonSentenceStartCapitalized;
}

export function summarizeSessionPronunciation(turns: ScoredTurn[]): SessionPronunciation {
  const scoredTurns = turns.length;
  let audioMs = 0;
  let accuracyWeightedSum = 0;
  let accuracyAudioMs = 0;
  let fluencyWeightedSum = 0;
  let fluencyAudioMs = 0;
  let prosodyWeightedSum = 0;
  let prosodyAudioMs = 0;

  for (const turn of turns) {
    audioMs += turn.audioMs;

    if (turn.accuracy !== null) {
      accuracyWeightedSum += turn.accuracy * turn.audioMs;
      accuracyAudioMs += turn.audioMs;
    }
    if (turn.fluency !== null) {
      fluencyWeightedSum += turn.fluency * turn.audioMs;
      fluencyAudioMs += turn.audioMs;
    }
    if (turn.prosody !== null) {
      prosodyWeightedSum += turn.prosody * turn.audioMs;
      prosodyAudioMs += turn.audioMs;
    }
  }

  const accuracy = accuracyAudioMs > 0 ? Math.round(accuracyWeightedSum / accuracyAudioMs) : null;
  const fluency = fluencyAudioMs > 0 ? Math.round(fluencyWeightedSum / fluencyAudioMs) : null;
  const prosody = prosodyAudioMs > 0 ? Math.round(prosodyWeightedSum / prosodyAudioMs) : null;

  type PatternData = {
    count: number;
    scoreSum: number;
    words: string[];
    seenWords: Set<string>;
  };
  const patternMap = new Map<string, PatternData>();

  for (const turn of turns) {
    for (const m of turn.mismatches) {
      if (isLikelyProperNoun(m.word, turn.transcript)) {
        continue;
      }
      const code = catalogCodeFor(m.expected, m.heard);
      if (!code) {
        continue;
      }

      let data = patternMap.get(code);
      if (!data) {
        data = {
          count: 0,
          scoreSum: 0,
          words: [],
          seenWords: new Set<string>(),
        };
        patternMap.set(code, data);
      }

      data.count += 1;
      data.scoreSum += m.score;

      const lowerWord = m.word.toLowerCase();
      if (!data.seenWords.has(lowerWord)) {
        data.seenWords.add(lowerWord);
        if (data.words.length < 5) {
          data.words.push(lowerWord);
        }
      }
    }
  }

  const patterns: PatternFinding[] = [];
  for (const [code, data] of patternMap.entries()) {
    patterns.push({
      code,
      count: data.count,
      words: data.words,
      meanScore: Math.round(data.scoreSum / data.count),
    });
  }

  patterns.sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return a.meanScore - b.meanScore;
  });

  const weakWordMap = new Map<string, number>();
  for (const turn of turns) {
    for (const w of turn.weakWords) {
      if (isLikelyProperNoun(w.word, turn.transcript)) {
        continue;
      }
      const lower = w.word.toLowerCase();
      const existing = weakWordMap.get(lower);
      if (existing === undefined || w.score < existing) {
        weakWordMap.set(lower, w.score);
      }
    }
  }

  const weakWords: { word: string; score: number }[] = [];
  for (const [word, score] of weakWordMap.entries()) {
    weakWords.push({ word, score: Math.round(score) });
  }

  weakWords.sort((a, b) => a.score - b.score);
  const cappedWeakWords = weakWords.slice(0, 8);

  return {
    scoredTurns,
    audioMs,
    accuracy,
    fluency,
    prosody,
    patterns,
    weakWords: cappedWeakWords,
  };
}

export function tipFocuses(summary: SessionPronunciation): Set<string> {
  const allowed = new Set<string>();
  for (const p of summary.patterns) {
    allowed.add(p.code);
  }
  for (const w of summary.weakWords) {
    allowed.add(w.word);
  }
  if (summary.fluency !== null && summary.fluency < 60) {
    allowed.add("fluency");
  }
  if (summary.prosody !== null && summary.prosody < 60) {
    allowed.add("prosody");
  }
  return allowed;
}

export const PRONUNCIATION_TIPS_PROMPT = `You write short, friendly pronunciation tips for an English learner after a spoken practice session. The input lists what automatic pronunciation scoring found: sound patterns (the English sound, what it sounded like, the learner's own words, and a reference tip), words that scored low, and the session's fluency and rhythm scores (0–100).

Rules:
- Write at most 3 tips, the most useful first. Each tip is one or two sentences, at most 200 characters.
- Each tip is about one item from the input. Set "focus" to that pattern's code or that word, exactly as written in the input, or to "fluency" or "prosody" when the input allows it.
- Never mention a sound or a word that isn't in the input, and don't guess at causes.
- Say how to make the sound, using the learner's own words as examples. Be encouraging. Never call the learner bad or wrong.
- Write in {language}. Keep English words, sounds and examples in English.

Return only JSON: {"tips":[{"focus":"...","tip":"..."}]}`;

export function buildTipsSystemPrompt(language: ExplanationLanguage): string {
  return PRONUNCIATION_TIPS_PROMPT.replaceAll("{language}", language);
}

export function buildTipsInput(summary: SessionPronunciation): string {
  const lines: string[] = ["Sound patterns:"];

  if (summary.patterns.length === 0) {
    lines.push("(none)");
  } else {
    for (const pattern of summary.patterns) {
      const p = findPattern(pattern.code);
      const target = p?.target ?? "";
      const heard = p?.heard ?? "";
      const words = pattern.words.join(", ");
      const tip = p?.tip ?? "";
      lines.push(
        `- ${pattern.code} | the sound ${target} sounded like ${heard} | learner's words: ${words} | reference tip: ${tip}`,
      );
    }
  }

  lines.push("Low-scoring words:");
  if (summary.weakWords.length === 0) {
    lines.push("(none)");
  } else {
    for (const w of summary.weakWords) {
      lines.push(`- ${w.word} (${w.score})`);
    }
  }

  const scoreParts: string[] = [];
  if (summary.fluency !== null) {
    scoreParts.push(`fluency ${summary.fluency}`);
  }
  if (summary.prosody !== null) {
    scoreParts.push(`rhythm and intonation ${summary.prosody}`);
  }
  if (scoreParts.length > 0) {
    lines.push(`Scores: ${scoreParts.join(", ")}`);
  }

  const focuses = tipFocuses(summary);
  const allowedScoreFocuses: string[] = [];
  if (focuses.has("fluency")) {
    allowedScoreFocuses.push('"fluency"');
  }
  if (focuses.has("prosody")) {
    allowedScoreFocuses.push('"prosody"');
  }
  if (allowedScoreFocuses.length > 0) {
    lines.push(`May use focus ${allowedScoreFocuses.join(", ")}.`);
  }

  return lines.join("\n");
}

export function parseTips(text: string, allowed: Set<string>): PronunciationTip[] | null {
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
  if (!Array.isArray(record.tips)) {
    return null;
  }

  const canonicalByLower = new Map<string, string>();
  for (const item of allowed) {
    canonicalByLower.set(item.toLowerCase(), item);
  }

  const seenFocuses = new Set<string>();
  const tips: PronunciationTip[] = [];

  for (const item of record.tips) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const itemRecord = item as Record<string, unknown>;
    if (typeof itemRecord.focus !== "string" || typeof itemRecord.tip !== "string") {
      continue;
    }

    const canonicalFocus = canonicalByLower.get(itemRecord.focus.trim().toLowerCase());
    if (!canonicalFocus) {
      continue;
    }

    const trimmedTip = itemRecord.tip.trim();
    if (!trimmedTip || trimmedTip.length > 300) {
      continue;
    }

    if (seenFocuses.has(canonicalFocus)) {
      continue;
    }
    seenFocuses.add(canonicalFocus);

    tips.push({ focus: canonicalFocus, tip: trimmedTip });
    if (tips.length >= 3) {
      break;
    }
  }

  return tips;
}

export async function waitForSettledCount(
  read: () => Promise<number>,
  options?: {
    intervalMs?: number;
    settleMs?: number;
    maxMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<number> {
  const intervalMs = options?.intervalMs ?? 2000;
  const settleMs = options?.settleMs ?? 6000;
  const maxMs = options?.maxMs ?? 40000;
  const sleep = options?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastCount = await read();
  if (settleMs <= 0) {
    return lastCount;
  }

  let unchangedElapsedMs = 0;
  let totalElapsedMs = 0;

  while (totalElapsedMs < maxMs) {
    await sleep(intervalMs);
    totalElapsedMs += intervalMs;
    const currentCount = await read();

    if (currentCount === lastCount) {
      unchangedElapsedMs += intervalMs;
      if (unchangedElapsedMs >= settleMs) {
        return currentCount;
      }
    } else {
      lastCount = currentCount;
      unchangedElapsedMs = 0;
    }
  }

  return lastCount;
}
