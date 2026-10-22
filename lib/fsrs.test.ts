import { describe, expect, it } from "vitest";

import { DEFAULT_FSRS_PARAMETERS } from "@/lib/db/schema";
import {
  ADAPT_AFTER_REVIEWS,
  BASE_THRESHOLDS,
  checkAnswer,
  editDistance,
  gradeReview,
  latencyThresholds,
  normalizeAnswer,
  scheduleReview,
  type CardSchedule,
  type Thresholds,
} from "@/lib/fsrs";

describe("normalizeAnswer", () => {
  it("lowercases and trims", () => {
    expect(normalizeAnswer("  Hello World  ")).toBe("hello world");
  });

  it("replaces curly quotes with straight ones", () => {
    expect(normalizeAnswer("Doesn’t ‘it’ “work”")).toBe("doesn't 'it' work");
  });

  it("removes punctuation other than apostrophe and collapses spaces", () => {
    expect(normalizeAnswer("Hello,   world! 123... How's it?")).toBe("hello world 123 how's it");
  });

  it("preserves non-Latin unicode letters", () => {
    expect(normalizeAnswer("¿Cómo estás? ¡Muy bien!")).toBe("cómo estás muy bien");
  });
});

describe("editDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(editDistance("hello", "hello")).toBe(0);
  });

  it("computes standard Levenshtein operations", () => {
    expect(editDistance("cat", "cats")).toBe(1); // insertion
    expect(editDistance("cats", "cat")).toBe(1); // deletion
    expect(editDistance("cat", "bat")).toBe(1); // substitution
  });

  it("supports adjacent transposition with distance 1", () => {
    expect(editDistance("receive", "recieve")).toBe(1);
    expect(editDistance("ab", "ba")).toBe(1);
  });
});

describe("checkAnswer", () => {
  it("marks correct ignoring case, punctuation and curly apostrophes", () => {
    expect(checkAnswer("Doesn’t", "doesn't")).toBe("correct");
    expect(checkAnswer("Hello, World!", "hello world")).toBe("correct");
  });

  it("marks close for one typo ('recieve' / 'receive')", () => {
    expect(checkAnswer("receive", "recieve")).toBe("close");
    expect(checkAnswer("recieve", "receive")).toBe("close");
  });

  it("marks close for right root, wrong form ('studying' vs 'studied')", () => {
    expect(checkAnswer("studying", "studied")).toBe("close");
    expect(checkAnswer("studied", "studying")).toBe("close");
    expect(checkAnswer("they are studying", "they are studied")).toBe("close");
  });

  it("marks wrong for irregular forms with different roots ('went' vs 'goes')", () => {
    expect(checkAnswer("went", "goes")).toBe("wrong");
    expect(checkAnswer("goes", "went")).toBe("wrong");
  });

  it("marks wrong for empty answers", () => {
    expect(checkAnswer("hello", "")).toBe("wrong");
    expect(checkAnswer("hello", "   ")).toBe("wrong");
    expect(checkAnswer("hello", "!@#$")).toBe("wrong");
  });

  it("marks wrong for an unrelated word", () => {
    expect(checkAnswer("apple", "banana")).toBe("wrong");
    expect(checkAnswer("elephant", "pencil")).toBe("wrong");
  });
});

describe("latencyThresholds", () => {
  it("returns base values below 30 samples for both spoken and typed modes", () => {
    const latencies29 = Array.from({ length: ADAPT_AFTER_REVIEWS - 1 }, () => 3_000);

    expect(latencyThresholds("spoken", latencies29)).toEqual(BASE_THRESHOLDS.spoken);
    expect(latencyThresholds("typed", latencies29)).toEqual(BASE_THRESHOLDS.typed);
    expect(latencyThresholds("spoken", [])).toEqual(BASE_THRESHOLDS.spoken);
  });

  it("calculates adapted values from 30 samples with a known median", () => {
    // 30 samples with median 5_000
    // easyMs = round(5000 * 0.8) = 4000
    // goodMs = round(5000 * 2) = 10000
    const latencies = Array.from({ length: 30 }, (_, i) => 4_000 + i * (2_000 / 29));
    const thresholds = latencyThresholds("spoken", latencies);

    // Median of values symmetrically centered around 5_000 is 5_000
    expect(thresholds.easyMs).toBe(4_000);
    expect(thresholds.goodMs).toBe(10_000);
  });

  it("clamps thresholds when the median is tiny", () => {
    // Median 500 ms -> raw easyMs 400, raw goodMs 1000
    // easyMs clamped to 1_500, goodMs clamped to easyMs + 1_000 = 2_500
    const fastLatencies = Array.from({ length: 30 }, () => 500);
    const thresholds = latencyThresholds("spoken", fastLatencies);

    expect(thresholds.easyMs).toBe(1_500);
    expect(thresholds.goodMs).toBe(2_500);
  });

  it("does not mutate the input array", () => {
    const original = [9_000, 2_000, 5_000, 1_000, 7_000];
    const copy = [...original];
    latencyThresholds("spoken", original);
    expect(original).toEqual(copy);
  });
});

describe("gradeReview", () => {
  const thresholds: Thresholds = { easyMs: 4_000, goodMs: 10_000 };

  it("grades wrong answers as 1 (Again) regardless of latency", () => {
    expect(gradeReview("wrong", 500, thresholds)).toBe(1);
    expect(gradeReview("wrong", 4_000, thresholds)).toBe(1);
    expect(gradeReview("wrong", 12_000, thresholds)).toBe(1);
  });

  it("grades close answers as 2 (Hard) regardless of latency", () => {
    expect(gradeReview("close", 500, thresholds)).toBe(2);
    expect(gradeReview("close", 4_000, thresholds)).toBe(2);
    expect(gradeReview("close", 12_000, thresholds)).toBe(2);
  });

  it("grades correct answers faster than easyMs as 4 (Easy)", () => {
    expect(gradeReview("correct", 3_999, thresholds)).toBe(4);
    expect(gradeReview("correct", 1_000, thresholds)).toBe(4);
  });

  it("grades correct answers at boundary easyMs as 3 (Good)", () => {
    expect(gradeReview("correct", 4_000, thresholds)).toBe(3);
  });

  it("grades correct answers between easyMs and goodMs as 3 (Good)", () => {
    expect(gradeReview("correct", 7_000, thresholds)).toBe(3);
  });

  it("grades correct answers at boundary goodMs as 3 (Good)", () => {
    expect(gradeReview("correct", 10_000, thresholds)).toBe(3);
  });

  it("grades correct answers slower than goodMs as 2 (Hard)", () => {
    expect(gradeReview("correct", 10_001, thresholds)).toBe(2);
    expect(gradeReview("correct", 20_000, thresholds)).toBe(2);
  });
});

describe("scheduleReview", () => {
  const now = new Date("2026-10-22T10:00:00Z");

  it("transitions a New card rated Good into Learning with short-term steps", () => {
    const newCard: CardSchedule = Object.freeze({
      state: "New",
      due: now,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      lastReview: null,
    });

    const params = {
      ...DEFAULT_FSRS_PARAMETERS,
      enable_fuzz: false,
    };

    const { card, log } = scheduleReview(newCard, 3, now, params);

    expect(card.state).toBe("Learning");
    expect(card.reps).toBe(1);
    expect(card.due.getTime()).toBeGreaterThan(now.getTime());
    expect(card.lastReview?.getTime()).toBe(now.getTime());

    expect(log.rating).toBe(3);
    expect(log.stateBefore).toBe("New");
    expect(log.stabilityBefore).toBe(0);
    expect(log.difficultyBefore).toBe(0);
  });

  it("keeps a New card rated Again in Learning with due ~1 minute later", () => {
    const newCard: CardSchedule = Object.freeze({
      state: "New",
      due: now,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      lastReview: null,
    });

    const params = {
      ...DEFAULT_FSRS_PARAMETERS,
      enable_fuzz: false,
    };

    const { card, log } = scheduleReview(newCard, 1, now, params);

    expect(card.state).toBe("Learning");
    // Default first step is "1m", so due is ~1 minute later (60,000 ms)
    const diffMs = card.due.getTime() - now.getTime();
    expect(diffMs).toBeGreaterThanOrEqual(50_000);
    expect(diffMs).toBeLessThanOrEqual(70_000);
    expect(log.rating).toBe(1);
    expect(log.stateBefore).toBe("New");
  });

  it("transitions a Review card rated Again to Relearning with lapses +1", () => {
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const reviewCard: CardSchedule = Object.freeze({
      state: "Review",
      due: now,
      stability: 10,
      difficulty: 5,
      elapsedDays: 10,
      scheduledDays: 10,
      learningSteps: 0,
      reps: 3,
      lapses: 0,
      lastReview: tenDaysAgo,
    });

    const params = {
      ...DEFAULT_FSRS_PARAMETERS,
      enable_fuzz: false,
    };

    const { card, log } = scheduleReview(reviewCard, 1, now, params);

    expect(card.state).toBe("Relearning");
    expect(card.lapses).toBe(1);
    expect(card.lastReview?.getTime()).toBe(now.getTime());

    expect(log.rating).toBe(1);
    expect(log.stateBefore).toBe("Review");
    expect(log.stabilityBefore).toBe(10);
    expect(log.difficultyBefore).toBe(5);
  });

  it("does not mutate the input card object", () => {
    const cardInput: CardSchedule = Object.freeze({
      state: "New",
      due: now,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      lastReview: null,
    });

    expect(() => {
      scheduleReview(cardInput, 3, now, DEFAULT_FSRS_PARAMETERS);
    }).not.toThrow();
  });
});
