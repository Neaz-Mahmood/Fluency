import {
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type Grade,
  type Steps,
} from "ts-fsrs";

import type { FsrsCard, FsrsParameters } from "@/lib/db/schema";

export type ReviewRating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy (fsrs_review_logs.rating)
export type AnswerMode = "typed" | "spoken";
export type AnswerResult = "correct" | "close" | "wrong";
export type Thresholds = { easyMs: number; goodMs: number };

// The memory-state columns of fsrs_cards.
export type CardSchedule = Pick<
  FsrsCard,
  | "state"
  | "due"
  | "stability"
  | "difficulty"
  | "elapsedDays"
  | "scheduledDays"
  | "learningSteps"
  | "reps"
  | "lapses"
  | "lastReview"
>;

export type ReviewLogFields = {
  rating: ReviewRating;
  stateBefore: FsrsCard["state"];
  stabilityBefore: number;
  difficultyBefore: number;
  elapsedDays: number;
  scheduledDays: number;
};

// Baseline response latency thresholds for spoken and typed reviews.
export const BASE_THRESHOLDS: Record<AnswerMode, Thresholds> = {
  spoken: { easyMs: 4_000, goodMs: 10_000 }, // research values
  typed: { easyMs: 6_000, goodMs: 15_000 }, // typing is slower; 1.5× the spoken values
};

// Reviews required before shifting from baseline to personalized latency thresholds.
export const ADAPT_AFTER_REVIEWS = 30;

// Multiplier applied to median latency for effortless recall (Easy rating).
export const EASY_MEDIAN_FACTOR = 0.8;

// Multiplier applied to median latency for acceptable recall (Good rating).
export const GOOD_MEDIAN_FACTOR = 2;

// Minimum allowable easy threshold in milliseconds to prevent unrealistic targets.
export const MIN_EASY_MS = 1_500;

// Minimum gap in milliseconds between easy and good latency thresholds.
export const MIN_GOOD_BUFFER_MS = 1_000;

/**
 * Schedules the next card review and generates review log fields using ts-fsrs.
 */
export function scheduleReview(
  card: CardSchedule,
  rating: ReviewRating,
  now: Date,
  params: FsrsParameters,
): { card: CardSchedule; log: ReviewLogFields } {
  const f = fsrs(
    generatorParameters({
      request_retention: params.request_retention,
      maximum_interval: params.maximum_interval,
      enable_fuzz: params.enable_fuzz,
      enable_short_term: params.enable_short_term,
      learning_steps: params.learning_steps as Steps,
      relearning_steps: params.relearning_steps as Steps,
    }),
  );

  const tsCard: Card = {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: State[card.state],
    last_review: card.lastReview ?? undefined,
  };

  const result = f.next(tsCard, now, rating as Grade);

  const updatedCard: CardSchedule = {
    state: State[result.card.state] as CardSchedule["state"],
    due: result.card.due,
    stability: result.card.stability,
    difficulty: result.card.difficulty,
    elapsedDays: result.card.elapsed_days,
    scheduledDays: result.card.scheduled_days,
    learningSteps: result.card.learning_steps,
    reps: result.card.reps,
    lapses: result.card.lapses,
    lastReview: result.card.last_review ?? now,
  };

  const log: ReviewLogFields = {
    rating,
    stateBefore: card.state,
    stabilityBefore: card.stability,
    difficultyBefore: card.difficulty,
    elapsedDays: result.log.elapsed_days,
    scheduledDays: result.log.scheduled_days,
  };

  return { card: updatedCard, log };
}

/**
 * Lowercases, converts curly quotes to straight quotes, removes non-letter/digit/apostrophe/space
 * characters, collapses whitespace, and trims.
 */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[^\p{L}\p{N}' ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Computes the Damerau-Levenshtein (optimal string alignment) distance between two strings,
 * supporting insertion, deletion, substitution, and transposition of adjacent characters.
 */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1); // transposition
      }
    }
  }

  return dp[m][n];
}

/**
 * Checks a learner's answer against the expected string.
 */
export function checkAnswer(expected: string, answer: string): AnswerResult {
  const normExpected = normalizeAnswer(expected);
  const normAnswer = normalizeAnswer(answer);

  if (normAnswer === "") {
    return "wrong";
  }

  if (normAnswer === normExpected) {
    return "correct";
  }

  const maxDistance = Math.max(1, Math.floor(normExpected.length / 5));
  if (editDistance(normExpected, normAnswer) <= maxDistance) {
    return "close";
  }

  const expectedWords = normExpected.split(" ");
  const answerWords = normAnswer.split(" ");
  if (expectedWords.length === answerWords.length) {
    const allRootsMatch = expectedWords.every((word, i) => {
      const ansWord = answerWords[i];
      const prefixLen = Math.min(4, word.length);
      return (
        ansWord.length >= prefixLen && word.slice(0, prefixLen) === ansWord.slice(0, prefixLen)
      );
    });
    if (allRootsMatch) {
      return "close";
    }
  }

  return "wrong";
}

/**
 * Computes personalized latency thresholds from the learner's past latencies.
 */
export function latencyThresholds(mode: AnswerMode, pastLatenciesMs: number[]): Thresholds {
  if (pastLatenciesMs.length < ADAPT_AFTER_REVIEWS) {
    return { ...BASE_THRESHOLDS[mode] };
  }

  const sorted = [...pastLatenciesMs].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  let easyMs = Math.round(median * EASY_MEDIAN_FACTOR);
  let goodMs = Math.round(median * GOOD_MEDIAN_FACTOR);

  easyMs = Math.max(MIN_EASY_MS, easyMs);
  goodMs = Math.max(easyMs + MIN_GOOD_BUFFER_MS, goodMs);

  return { easyMs, goodMs };
}

/**
 * Determines an FSRS review rating from answer accuracy and response latency.
 */
export function gradeReview(
  result: AnswerResult,
  latencyMs: number,
  thresholds: Thresholds,
): ReviewRating {
  if (result === "wrong") {
    return Rating.Again as ReviewRating;
  }
  if (result === "close") {
    return Rating.Hard as ReviewRating;
  }
  if (latencyMs < thresholds.easyMs) {
    return Rating.Easy as ReviewRating;
  }
  if (latencyMs <= thresholds.goodMs) {
    return Rating.Good as ReviewRating;
  }
  return Rating.Hard as ReviewRating;
}
