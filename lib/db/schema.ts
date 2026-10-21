import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Learner model and FSRS schema. Based on the research schema, with the changes in
// doc/roadmap.md (Phase 2): nullable user_id for login, sessions/turns, and voice_usage.

export const langCode = pgEnum("lang_code", ["en-US", "en-GB", "es-ES", "es-MX", "bn-BD"]);
export const cefrLevel = pgEnum("cefr_level", ["A1", "A2", "B1", "B2", "C1", "C2"]);
export const fsrsState = pgEnum("fsrs_state", ["New", "Learning", "Review", "Relearning"]);
export const errorModality = pgEnum("error_modality", [
  "SPEAKING_GRAMMAR",
  "WRITING_GRAMMAR",
  "PRONUNCIATION_IPA",
  "PROSODY",
]);
export const cardType = pgEnum("card_type", [
  "VOCABULARY",
  "GRAMMAR_PATTERN",
  "PRONUNCIATION_DRILL",
]);
export const answerMode = pgEnum("answer_mode", ["typed", "spoken"]);
export const sessionMode = pgEnum("session_mode", ["conversation", "placement"]);
export const turnRole = pgEnum("turn_role", ["user", "assistant"]);
export const inputMode = pgEnum("input_mode", ["voice", "typed"]);

export type FsrsParameters = {
  request_retention: number;
  maximum_interval: number;
  enable_fuzz: boolean;
  enable_short_term: boolean;
  learning_steps: string[];
  relearning_steps: string[];
};

export const DEFAULT_FSRS_PARAMETERS: FsrsParameters = {
  request_retention: 0.9,
  maximum_interval: 365,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
};

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

// 1. One row per learner. Created anonymously on first visit (lib/learner.ts);
// user_id is set when the learner signs up in Phase 5.
export const learnerProfiles = pgTable(
  "learner_profiles",
  {
    learnerId: uuid("learner_id").primaryKey().defaultRandom(),
    userId: text("user_id").unique(),
    // Null until onboarding sets it.
    nativeLanguage: langCode("native_language"),
    targetLanguage: langCode("target_language").notNull().default("en-US"),
    anxietyGentleMode: boolean("anxiety_gentle_mode").notNull().default(false),
    speakingSpeedMultiplier: numeric("speaking_speed_multiplier", { precision: 3, scale: 2 })
      .notNull()
      .default("1.00"),
    // Null until placement sets a provisional level.
    cefrSpeaking: cefrLevel("cefr_speaking"),
    cefrWriting: cefrLevel("cefr_writing"),
    cefrListening: cefrLevel("cefr_listening"),
    cefrReading: cefrLevel("cefr_reading"),
    interests: text("interests")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    learningGoals: text("learning_goals")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    fsrsParameters: jsonb("fsrs_parameters")
      .$type<FsrsParameters>()
      .notNull()
      .default(DEFAULT_FSRS_PARAMETERS),
    // Under 250 tokens; rebuilt after each session and injected into the system prompt.
    compactTutorSummary: text("compact_tutor_summary").notNull().default(""),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "valid_language_pair",
      sql`${table.nativeLanguage} IS NULL OR ${table.nativeLanguage} <> ${table.targetLanguage}`,
    ),
    check("speaking_speed_range", sql`${table.speakingSpeedMultiplier} BETWEEN 0.50 AND 1.50`),
  ],
);

const learnerRef = () =>
  uuid("learner_id")
    .notNull()
    .references(() => learnerProfiles.learnerId, { onDelete: "cascade" });

// 2. Recurring grammar and pronunciation errors (ERRANT codes and Azure IPA).
export const learnerErrorPatterns = pgTable(
  "learner_error_patterns",
  {
    patternId: uuid("pattern_id").primaryKey().defaultRandom(),
    learnerId: learnerRef(),
    modality: errorModality("modality").notNull(),
    // e.g. 'R:VERB:TENSE', 'M:DET', 'SUBJUNCTIVE_TRIGGER', 'IPA:/ɪ/_to_[i]'
    errorCode: varchar("error_code", { length: 64 }).notNull(),
    description: text("description").notNull(),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    resolvedStreak: integer("resolved_streak").notNull().default(0),
    lastExampleLearnerInput: text("last_example_learner_input"),
    lastExampleMinimalCorrection: text("last_example_minimal_correction"),
    // Azure AccuracyScore, 0–100.
    meanAcousticAccuracy: numeric("mean_acoustic_accuracy", { precision: 5, scale: 2 }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.learnerId, table.modality, table.errorCode)],
);

// 3. FSRS cards. Memory-state columns mirror the ts-fsrs Card type.
export const fsrsCards = pgTable(
  "fsrs_cards",
  {
    cardId: uuid("card_id").primaryKey().defaultRandom(),
    learnerId: learnerRef(),
    cardType: cardType("card_type").notNull(),
    // Word, phrase or construction in the target language.
    targetItem: text("target_item").notNull(),
    // Explanation or translation in the native language.
    nativeTranslation: text("native_translation").notNull(),
    // Sentence where the learner met or missed the item.
    sourceContextSentence: text("source_context_sentence"),
    targetIpaPhonemes: varchar("target_ipa_phonemes", { length: 128 }),
    state: fsrsState("state").notNull().default("New"),
    due: timestamp("due", { withTimezone: true }).notNull().defaultNow(),
    stability: doublePrecision("stability").notNull().default(0),
    difficulty: doublePrecision("difficulty").notNull().default(0),
    elapsedDays: integer("elapsed_days").notNull().default(0),
    scheduledDays: integer("scheduled_days").notNull().default(0),
    // Current position in learning_steps / relearning_steps (ts-fsrs short-term mode).
    learningSteps: integer("learning_steps").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    lastReview: timestamp("last_review", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("idx_fsrs_cards_due")
      .on(table.learnerId, table.due)
      .where(sql`${table.state} <> 'New'`),
  ],
);

// 4. Immutable review log, kept for the FSRS optimizer.
export const fsrsReviewLogs = pgTable(
  "fsrs_review_logs",
  {
    logId: uuid("log_id").primaryKey().defaultRandom(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => fsrsCards.cardId, { onDelete: "cascade" }),
    learnerId: learnerRef(),
    // 1 Again, 2 Hard, 3 Good, 4 Easy
    rating: smallint("rating").notNull(),
    stateBefore: fsrsState("state_before").notNull(),
    stabilityBefore: doublePrecision("stability_before").notNull(),
    difficultyBefore: doublePrecision("difficulty_before").notNull(),
    elapsedDays: integer("elapsed_days").notNull(),
    scheduledDays: integer("scheduled_days").notNull(),
    // Typed and spoken answers use separate latency thresholds.
    answerMode: answerMode("answer_mode"),
    responseLatencyMs: integer("response_latency_ms"),
    generatedReviewSentence: text("generated_review_sentence"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("valid_rating", sql`${table.rating} BETWEEN 1 AND 4`),
    index("idx_fsrs_review_logs_card").on(table.cardId, table.reviewedAt),
  ],
);

// 5. Practice sessions and their turns (saved transcripts).
export const sessions = pgTable(
  "sessions",
  {
    sessionId: uuid("session_id").primaryKey().defaultRandom(),
    learnerId: learnerRef(),
    mode: sessionMode("mode").notNull().default("conversation"),
    // A ScenarioId from lib/scenarios.ts; null for placement.
    scenarioId: varchar("scenario_id", { length: 64 }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [index("idx_sessions_learner_started").on(table.learnerId, table.startedAt.desc())],
);

export const sessionTurns = pgTable(
  "session_turns",
  {
    turnId: uuid("turn_id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.sessionId, { onDelete: "cascade" }),
    // 0-based order within the session.
    position: integer("position").notNull(),
    role: turnRole("role").notNull(),
    content: text("content").notNull(),
    // How the learner produced a user turn; null for assistant turns.
    inputMode: inputMode("input_mode"),
    // Latency for assistant turns: server time to first token, client time to first audio.
    firstTokenMs: integer("first_token_ms"),
    firstAudioMs: integer("first_audio_ms"),
    ...timestamps,
  },
  (table) => [unique().on(table.sessionId, table.position)],
);

// 6. Daily voice usage for the quota. Replaces daily_free_voice_seconds_used,
// which had no reset date.
export const voiceUsage = pgTable(
  "voice_usage",
  {
    learnerId: learnerRef(),
    day: date("day", { mode: "string" }).notNull(),
    secondsUsed: integer("seconds_used").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.learnerId, table.day] }),
    check("non_negative_seconds", sql`${table.secondsUsed} >= 0`),
  ],
);

export type LearnerProfile = typeof learnerProfiles.$inferSelect;
export type NewLearnerProfile = typeof learnerProfiles.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type SessionTurn = typeof sessionTurns.$inferSelect;
export type FsrsCard = typeof fsrsCards.$inferSelect;
