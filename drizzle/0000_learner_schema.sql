CREATE TYPE "public"."answer_mode" AS ENUM('typed', 'spoken');--> statement-breakpoint
CREATE TYPE "public"."card_type" AS ENUM('VOCABULARY', 'GRAMMAR_PATTERN', 'PRONUNCIATION_DRILL');--> statement-breakpoint
CREATE TYPE "public"."cefr_level" AS ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2');--> statement-breakpoint
CREATE TYPE "public"."error_modality" AS ENUM('SPEAKING_GRAMMAR', 'WRITING_GRAMMAR', 'PRONUNCIATION_IPA', 'PROSODY');--> statement-breakpoint
CREATE TYPE "public"."fsrs_state" AS ENUM('New', 'Learning', 'Review', 'Relearning');--> statement-breakpoint
CREATE TYPE "public"."input_mode" AS ENUM('voice', 'typed');--> statement-breakpoint
CREATE TYPE "public"."lang_code" AS ENUM('en-US', 'en-GB', 'es-ES', 'es-MX');--> statement-breakpoint
CREATE TYPE "public"."session_mode" AS ENUM('conversation', 'placement');--> statement-breakpoint
CREATE TYPE "public"."turn_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "fsrs_cards" (
	"card_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"card_type" "card_type" NOT NULL,
	"target_item" text NOT NULL,
	"native_translation" text NOT NULL,
	"source_context_sentence" text,
	"target_ipa_phonemes" varchar(128),
	"state" "fsrs_state" DEFAULT 'New' NOT NULL,
	"due" timestamp with time zone DEFAULT now() NOT NULL,
	"stability" double precision DEFAULT 0 NOT NULL,
	"difficulty" double precision DEFAULT 0 NOT NULL,
	"elapsed_days" integer DEFAULT 0 NOT NULL,
	"scheduled_days" integer DEFAULT 0 NOT NULL,
	"learning_steps" integer DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"last_review" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fsrs_review_logs" (
	"log_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"state_before" "fsrs_state" NOT NULL,
	"stability_before" double precision NOT NULL,
	"difficulty_before" double precision NOT NULL,
	"elapsed_days" integer NOT NULL,
	"scheduled_days" integer NOT NULL,
	"answer_mode" "answer_mode",
	"response_latency_ms" integer,
	"generated_review_sentence" text,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valid_rating" CHECK ("fsrs_review_logs"."rating" BETWEEN 1 AND 4)
);
--> statement-breakpoint
CREATE TABLE "learner_error_patterns" (
	"pattern_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"modality" "error_modality" NOT NULL,
	"error_code" varchar(64) NOT NULL,
	"description" text NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"resolved_streak" integer DEFAULT 0 NOT NULL,
	"last_example_learner_input" text,
	"last_example_minimal_correction" text,
	"mean_acoustic_accuracy" numeric(5, 2),
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_error_patterns_learner_id_modality_error_code_unique" UNIQUE("learner_id","modality","error_code")
);
--> statement-breakpoint
CREATE TABLE "learner_profiles" (
	"learner_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"native_language" "lang_code",
	"target_language" "lang_code" DEFAULT 'en-US' NOT NULL,
	"anxiety_gentle_mode" boolean DEFAULT false NOT NULL,
	"speaking_speed_multiplier" numeric(3, 2) DEFAULT '1.00' NOT NULL,
	"cefr_speaking" "cefr_level",
	"cefr_writing" "cefr_level",
	"cefr_listening" "cefr_level",
	"cefr_reading" "cefr_level",
	"interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"learning_goals" text[] DEFAULT '{}'::text[] NOT NULL,
	"fsrs_parameters" jsonb DEFAULT '{"request_retention":0.9,"maximum_interval":365,"enable_fuzz":true,"enable_short_term":true,"learning_steps":["1m","10m"],"relearning_steps":["10m"]}'::jsonb NOT NULL,
	"compact_tutor_summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "valid_language_pair" CHECK ("learner_profiles"."native_language" IS NULL OR "learner_profiles"."native_language" <> "learner_profiles"."target_language"),
	CONSTRAINT "speaking_speed_range" CHECK ("learner_profiles"."speaking_speed_multiplier" BETWEEN 0.50 AND 1.50)
);
--> statement-breakpoint
CREATE TABLE "session_turns" (
	"turn_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"role" "turn_role" NOT NULL,
	"content" text NOT NULL,
	"input_mode" "input_mode",
	"first_token_ms" integer,
	"first_audio_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_turns_session_id_position_unique" UNIQUE("session_id","position")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"mode" "session_mode" DEFAULT 'conversation' NOT NULL,
	"scenario_id" varchar(64),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "voice_usage" (
	"learner_id" uuid NOT NULL,
	"day" date NOT NULL,
	"seconds_used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "voice_usage_learner_id_day_pk" PRIMARY KEY("learner_id","day"),
	CONSTRAINT "non_negative_seconds" CHECK ("voice_usage"."seconds_used" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fsrs_cards" ADD CONSTRAINT "fsrs_cards_learner_id_learner_profiles_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner_profiles"("learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fsrs_review_logs" ADD CONSTRAINT "fsrs_review_logs_card_id_fsrs_cards_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."fsrs_cards"("card_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fsrs_review_logs" ADD CONSTRAINT "fsrs_review_logs_learner_id_learner_profiles_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner_profiles"("learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_error_patterns" ADD CONSTRAINT "learner_error_patterns_learner_id_learner_profiles_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner_profiles"("learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_turns" ADD CONSTRAINT "session_turns_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_learner_id_learner_profiles_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner_profiles"("learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_usage" ADD CONSTRAINT "voice_usage_learner_id_learner_profiles_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner_profiles"("learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fsrs_cards_due" ON "fsrs_cards" USING btree ("learner_id","due") WHERE "fsrs_cards"."state" <> 'New';--> statement-breakpoint
CREATE INDEX "idx_fsrs_review_logs_card" ON "fsrs_review_logs" USING btree ("card_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_learner_started" ON "sessions" USING btree ("learner_id","started_at" DESC NULLS LAST);