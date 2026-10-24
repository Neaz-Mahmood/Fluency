CREATE TYPE "public"."feedback_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
ALTER TYPE "public"."session_mode" ADD VALUE 'writing';--> statement-breakpoint
CREATE TABLE "session_feedback" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"learner_id" uuid NOT NULL,
	"status" "feedback_status" DEFAULT 'pending' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vocabulary" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_feedback" ADD CONSTRAINT "session_feedback_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_feedback" ADD CONSTRAINT "session_feedback_learner_id_learner_profiles_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner_profiles"("learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fsrs_cards" ADD CONSTRAINT "fsrs_cards_learner_id_card_type_target_item_unique" UNIQUE("learner_id","card_type","target_item");