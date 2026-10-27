-- Least-privilege roles for the web app and the voice worker (FLU-100). They're created here
-- without LOGIN, so every database (local, test, Supabase) gets the same grants. Production makes
-- them logins with a password set by hand (README, Deployment). Migrations keep running as the
-- owner, which is the only role that can change the schema.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fluency_app') THEN
    CREATE ROLE fluency_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fluency_worker') THEN
    CREATE ROLE fluency_worker NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO fluency_app, fluency_worker;
--> statement-breakpoint
-- The web app reads and writes every table, including tables later migrations add.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fluency_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fluency_app;
--> statement-breakpoint
-- The voice worker gets only what worker/ uses, and never DELETE. A table it needs later is
-- granted in that table's own migration.
GRANT SELECT ON learner_profiles, fsrs_cards, learner_error_patterns TO fluency_worker;
--> statement-breakpoint
-- UPDATE because saveExchange locks the session row with SELECT ... FOR UPDATE.
GRANT SELECT, INSERT, UPDATE ON sessions TO fluency_worker;
--> statement-breakpoint
GRANT SELECT, INSERT ON session_turns TO fluency_worker;
--> statement-breakpoint
GRANT INSERT ON pronunciation_scores TO fluency_worker;
--> statement-breakpoint
-- The quota meter upserts the day's row.
GRANT SELECT, INSERT, UPDATE ON voice_usage TO fluency_worker;
