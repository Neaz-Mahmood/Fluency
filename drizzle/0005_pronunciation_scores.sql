CREATE TABLE "pronunciation_scores" (
	"turn_id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"audio_ms" integer NOT NULL,
	"accuracy" double precision,
	"fluency" double precision,
	"prosody" double precision,
	"completeness" double precision,
	"pron_score" double precision,
	"weak_words" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mismatches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pronunciation_scores" ADD CONSTRAINT "pronunciation_scores_turn_id_session_turns_turn_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."session_turns"("turn_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pronunciation_scores" ADD CONSTRAINT "pronunciation_scores_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pronunciation_scores" ADD CONSTRAINT "pronunciation_scores_learner_id_learner_profiles_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner_profiles"("learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pronunciation_scores_session" ON "pronunciation_scores" USING btree ("session_id");