# Status and next work

Where Fluency stands today and what to work on next. The long-range plan is in [roadmap.md](./roadmap.md). This page turns its next steps into concrete tasks against the current code.

Last checked: 2026-10-22.

## What it is

A snapshot of the app's health, the gaps between the current code and the roadmap's Phase 2, and an ordered task list: housekeeping first (Week 0), then Phase 2 (Weeks 1–3).

## Current status

### Built and working (Phases 0–3)

| Area                                                                                      | State                       | Where                                                                           |
| ----------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| App shell, home page, practice route                                                      | Working                     | `app/layout.tsx`, `app/page.tsx`, `app/practice/page.tsx`                       |
| Four scenarios                                                                            | Working                     | `lib/scenarios.ts`, `components/ScenarioPicker.tsx`                             |
| Streaming chat with Claude, Gemini or OpenCode                                            | Working                     | `app/api/chat/route.ts`, `lib/anthropic.ts`, `lib/google.ts`, `lib/provider.ts` |
| Request validation (max 40 turns, max 2,000 chars per message, history from the database) | Working                     | `lib/chat-request.ts`                                                           |
| Hold-to-talk and hands-free voice input (Web Speech, Chrome)                              | Working                     | `lib/stt.ts`, `hooks/useConversation.ts`                                        |
| Spoken replies, split into sentences (Web Speech)                                         | Working                     | `lib/tts.ts`                                                                    |
| Typed fallback                                                                            | Working                     | `hooks/useConversation.ts`, `components/ConversationControls.tsx`               |
| Implicit correction (the partner rephrases unclear English)                               | Working, in the prompt only | `lib/prompts.ts`                                                                |
| Anonymous learners and "Delete my data"                                                   | Working                     | `proxy.ts`, `lib/learner.ts`, `app/settings/`                                   |
| Saved sessions and session history                                                        | Working                     | `lib/sessions.ts`, `app/history/`                                               |
| Latency logging (first token, first audio)                                                | Working                     | `app/api/chat/route.ts`, `app/practice/actions.ts`                              |
| Evaluation harness (pnpm eval)                                                            | Working                     | `scripts/eval/`                                                                 |
| Onboarding and native-language setting                                                    | Working                     | `app/onboarding/`, `lib/languages.ts`                                           |
| Bangla UI                                                                                 | Working                     | `lib/messages.ts`                                                               |
| Placement chat (provisional CEFR level)                                                   | Working                     | `app/placement/`, `lib/placement.ts`                                            |
| Learner-aware prompt and learner summary                                                  | Working                     | `lib/prompts.ts`, `lib/summary.ts`, `app/practice/actions.ts`                   |
| Post-session feedback and recap                                                           | Working                     | `lib/feedback.ts`, `lib/feedback-job.ts`, `components/Recap.tsx`                |
| Error patterns                                                                            | Working                     | `lib/feedback-store.ts`                                                         |
| Flashcards and review                                                                     | Working                     | `lib/cards.ts`, `lib/fsrs.ts`, `app/review/`                                    |
| Writing coach                                                                             | Working                     | `app/write/`                                                                    |

### Health checks

| Check           | Result                                                                                                                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`  | Passes                                                                                                                                                                                                                     |
| `eslint .`      | Passes, no warnings                                                                                                                                                                                                        |
| `next build`    | Passes. `/api/chat` is dynamic; `/`, `/practice`, `/history`, `/history/[sessionId]`, `/onboarding`, `/placement`, `/review`, `/settings` and `/write` are partially prerendered (static shell, learner data streamed in). |
| Automated tests | `pnpm test`: 258 unit tests in 18 files. `pnpm test:db`: 49 database tests in 4 files against `fluency_test`.                                                                                                              |
| `pnpm eval`     | Runs. Live `claude-opus-5-5` on 200 bn → en sentences (100 error-free): over-correction 0/100 (0.0%), edits expected 100, predicted 97, matched 93, edit F0.5 0.953 (precision 0.959, recall 0.930).                       |
| Version control | Git, pushed to GitHub. Feature work happens on `feat/v1`.                                                                                                                                                                  |

### Gaps and risks in the current code

1. ~~**No version control.**~~ Fixed: the repo is in git and on GitHub.
2. **`/api/chat` is open.** Login is built last (end of Phase 5), so the route stays open until then. Run the app locally, or set the optional `ACCESS_CODE` gate (Week 1) before deploying it anywhere testers can reach. Otherwise anyone with the URL can spend the API key.
3. ~~**Two lockfiles.**~~ Fixed: pnpm only.
4. ~~**No tests.**~~ Fixed for the server modules. The UI, the `/api/chat` route and the Server Functions still have no automated tests.
5. ~~**Everything is in memory.**~~ Fixed: turns are saved (FLU-22) and a reload loads them back from the database (FLU-23).
6. ~~**No latency numbers.**~~ Fixed: server time to first token and client time to first audio are recorded per assistant turn in `session_turns` (FLU-25).
7. **Hard-coded English.** `lang = "en-US"` in `lib/stt.ts` and `lib/tts.ts`. Fixed for the UI (FLU-29): Bangla speakers see Bangla UI text; `/api/chat` error messages, the nav, settings, history list and the partner's replies stay English.
8. ~~**The prompt is the same for every learner.**~~ Fixed: `getSystemPrompt(scenarioId, learner)` adapts to the learner's CEFR speaking level, native language, and compact tutor summary (FLU-32).
9. ~~**`components/Conversation.tsx` is 448 lines** and has raw hex colors instead of the design tokens in `DESIGN.md`.~~ Fixed: state machine moved to `hooks/useConversation.ts` and hex colors replaced with design tokens (FLU-26).
10. **Web Speech recognition only works fully in Chrome.** Phase 4 replaces it. Until then, the typed fallback covers other browsers.
11. ~~**Placement's token limit is tight.** `finishPlacement` gives the feedback model `maxTokens: 200`, and Opus 5.5's thinking counts toward it, so the levels can be cut off.~~ Fixed: raised `maxTokens` to 1,000 for the feedback model (FLU-38).
12. **A closed tab builds neither a summary nor feedback.** Only "Finish and get feedback" and "Switch scenario" end a session and trigger the learner summary and feedback job.
13. **The eval runs only locally.** There is no CI yet, so "CI fails the build if over-correction rises" isn't wired; `pnpm eval` already exits 1 on failure.

### Latency baseline

Baseline: not measured yet. Run the query after at least 20 spoken turns and record p50/p90 here.

```sql
-- docker compose exec db psql -U fluency fluency
SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY first_token_ms) AS token_p50,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY first_token_ms) AS token_p90,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY first_audio_ms) AS audio_p50,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY first_audio_ms) AS audio_p90
FROM session_turns WHERE role = 'assistant';
```

## What to work on

Tasks are in order. Each one lists the files it touches and what "done" means.

### Week 0 — Housekeeping (1–2 days)

- [x] **Set up git.** Done: the repo is on GitHub (`origin/main`), `.env` is ignored and not committed, and work continues on `feat/v1`.
- [x] **Pick one package manager.** Done: pnpm (`packageManager: pnpm@11.25.0`). `package-lock.json` is deleted and `README.md` uses `pnpm install` / `pnpm dev`.
- [x] **Add a test runner.** Done: Vitest (`vitest.config.mts`) with `pnpm test` and `pnpm test:watch`. `lib/chat-request.test.ts` and `lib/provider.test.ts` cover every error branch (23 tests). The config stubs `server-only` so server modules can be imported in tests.
- [x] **Choose the Postgres host and database library.** Done: Postgres + Drizzle, running locally in Docker (`docker-compose.yml`, `pnpm db:up`). The managed host is Supabase in Mumbai (ap-south-1), reached through the Session pooler; the live voice worker uses it (FLU-67). See [roadmap.md](./roadmap.md#open-decisions). Login (email/password and Google) is built last, in Phase 5, so the auth library can wait. It must work with whatever database you pick here.

Done when: the repo has history, `pnpm test` passes, and the database is chosen.

### Phase 2 — Weeks 1–3: Learner model and measurement

#### Week 1: Anonymous learners and the database

- [x] **Schema and migrations.** Done: all seven tables in `lib/db/schema.ts`, migration `drizzle/0000_learner_schema.sql`, client in `lib/db.ts`. Every table cascades from `learner_profiles`. `native_language` and the CEFR levels stay null until onboarding and placement.
- [x] **Anonymous learner ID.** Done. `proxy.ts` gives every browser a `fluency_learner` cookie (httpOnly, `SameSite=Lax`, `Secure` in production) and forwards it on the same request. No database work happens there. `getLearner()` in `lib/learner.ts` creates the `learner_profiles` row on first use with `ON CONFLICT DO NOTHING`, so concurrent first requests make exactly one row. `/api/chat` loads the learner and returns a 503 if the database is unreachable. This is the only place Phase 5 login has to change. Tests: `proxy.test.ts`, `lib/learner-id.test.ts`, and `lib/learner.db.test.ts` (`pnpm test:db`).
- [x] **Delete my data.** Done. `/settings` (linked in the nav) has a two-step confirm that calls the `deleteMyData` Server Function (`app/settings/actions.ts`). `deleteCurrentLearner()` in `lib/learner.ts` takes the learner from the cookie, never from the client, deletes the row (which cascades through every table) and clears the cookie. The next request gets a fresh id. `lib/learner.db.test.ts` seeds every table for two learners, deletes one, and checks all 7 tables are empty for that learner while the other is untouched.
- [ ] **Optional `ACCESS_CODE` gate.** In `proxy.ts`, if `ACCESS_CODE` is set, require it once (stored in a cookie) before serving `/practice` and `/api/chat`. Skip this while running only on localhost. Next.js 16 renamed `middleware` to `proxy`; see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.

Done when: a first visit creates exactly one learner row, a reload reuses it, and deleting your data leaves no rows behind.

#### Week 2: Saved sessions and measurement

- [x] **Save sessions.** Done (FLU-22). A session is created on the first message, not when a scenario is picked, so browsing scenarios leaves no empty sessions. The server returns its id in `X-Session-Id`, and the client sends it back. `resolveSession()` only reuses a session that belongs to this learner and scenario. `after()` waits for the stream to end and saves the user turn (with `inputMode`) and the reply in one locked transaction. See `doc/api.md`.
- [x] **Load from the database.** Done (FLU-23). The client sends only the new `message`; the route builds the history from `session_turns` with `buildHistory()`. `/practice?session=<id>` reloads the conversation from the database, for the learner's own open sessions only.
- [x] **Session history page.** Done (FLU-24). Past sessions are listed at `/history` and each opens a read-only transcript at `/history/[sessionId]`.
- [x] **Latency logging.** Done (FLU-25): server time to first token and client time to first audio are recorded per assistant turn in `session_turns`.
- [x] **Split `Conversation.tsx`.** Done (FLU-26). Move the audio and turn state machine into a hook (for example `useConversation`) and keep the component for layout. Replace raw hex values with `DESIGN.md` tokens while you're there.
- [x] **Evaluation harness skeleton.** Done (FLU-27). Runs `pnpm eval` against `scripts/eval/golden/bn-en.json` using the baseline `noEdits` corrector to report over-correction rate and edit counts.

Done when: a reload shows the same conversation, every turn has latency numbers, and `pnpm eval` prints a report.

#### Week 3: Learner model and placement

- [x] **Language settings.** Done (FLU-28): onboarding sets the native language on the learner profile and sends learners without one there before they practice.
- [x] **Bangla UI strings.** Done (FLU-29): the home page, scenario picker, practice controls, transcript and speech/error messages come from an English or Bangla dictionary in `lib/messages.ts`, picked by the learner's native language.
- [x] **Placement chat.** Done (FLU-30). A 6-question diagnostic chat at `/placement` estimates provisional speaking and writing CEFR levels using the feedback model.
- [x] **Learner summary.** Done (FLU-31). Triggered by "Switch scenario", which ends the session and asks the feedback model for a note capped at 700 chars in `after()`. A closed tab leaves the session open and builds no summary.
- [x] **Level-aware prompt rules.** Done (FLU-32): added level-specific scaffolding rules for A1–C2, native-language support for A1–B1, and learner summaries to `lib/prompts.ts`.

Done when: a new learner completes placement, finishes one session, and their next session's system prompt includes their level and a summary under 250 tokens (checked on 20 test profiles).

### Phase 2 exit check

- [x] Transcripts persist across reloads in the same browser. `/practice?session=<id>` reloads the learner's open session from the database (FLU-23); `lib/sessions.db.test.ts`.
- [x] Placement finishes in 6 turns or fewer. `/api/chat` answers a 7th placement answer with 409 before calling the model (FLU-30); checked live, no automated route test.
- [x] The summary stays under 250 tokens on 20 test profiles. `lib/summary.test.ts` ("FLU-31 20 test profiles check").
- [x] "Delete my data" leaves no rows (test passes). `lib/learner.db.test.ts` seeds all 7 tables and checks they are empty after the delete.
- [ ] Latency is logged on every turn, and a baseline p50/p90 is written into this page. Logging is in place; the p50/p90 baseline needs real spoken sessions (see Latency baseline).

### Phase 3 — Weeks 4–6: Feedback, flashcards, writing

- [x] **Correction prompt and parser.** Done (FLU-39): `lib/feedback.ts` defines the precision-first correction prompt, input formatter, parser dropping edits not found in the line, and explanation language rules.
- [x] **Bangla golden set.** Done (FLU-40): expanded `scripts/eval/golden/bn-en.json` to 200 sentences (100 error-free) typical of Bangla-speaker English, pending native review.
- [x] **Eval harness gate.** Done (FLU-41): `pnpm eval` runs the real corrector on the feedback model with a 5% over-correction gate and records `scripts/eval/baseline.json`.
- [x] **Feedback and card schema.** Done (FLU-42): added writing session mode, `session_feedback`, and unique constraints on `fsrs_cards` in migration 0002.
- [x] **Feedback job and error patterns.** Done (FLU-43): ending a session triggers `runFeedback` in `after()`, saving corrections and tracking ERRANT error codes and streaks in `learner_error_patterns`.
- [x] **Feedback recap screen.** Done (FLU-44): "Finish and get feedback" ends the session and opens `/history/[sessionId]`, showing minimal edits, upgrades, explanations, and words to remember.
- [x] **FSRS scheduling and speed grading.** Done (FLU-45): added `ts-fsrs` 5.4.2 scheduling and answer checking rated by latency with mode thresholds adapting after 30 reviews.
- [x] **Save flashcards from recap.** Done (FLU-46): added save buttons on recap edits and vocabulary words, saving `GRAMMAR_PATTERN` and `VOCABULARY` cards by feedback index.
- [x] **Card review with AI sentences.** Done (FLU-47): `/review` presents due cards with fresh AI-generated cloze sentences, grading spoken or typed answers and logging reviews.
- [x] **Writing coach.** Done (FLU-48): `/write` accepts paragraphs or emails up to 2,000 characters, evaluates them sentence by sentence, and redirects to the recap.

### Phase 3 exit check

- [x] Over-correction on error-free golden sentences below 5%: 0/100 (0.0%) on 200 bn → en sentences (pending native review of the golden set).
- [x] Edit F0.5 recorded as a baseline: 0.953 in `scripts/eval/baseline.json`, on normalized span match, not ERRANT.
- [ ] CI fails the build if over-correction goes up: not wired, since there is no CI yet. `pnpm eval` exits 1 at ≥5% or a rise of more than one sentence over the baseline.

## After Phase 3

Phase 4 is next (voice tutor and pronunciation, see [roadmap.md](./roadmap.md)), and its week 7 starts with vendor tests.

## Notes

- The background worker the roadmap mentions is only required in Phase 4, when the voice agent needs a long-lived process. In Phase 2, `after()` in route handlers is enough for saving turns and building summaries.
- Read `node_modules/next/dist/docs/` before using any Next.js API. This is Next.js 16, and some conventions differ from older versions; `proxy.ts` replacing `middleware.ts` is one example.
- Keep [features.md](./features.md) and [out-of-scope.md](./out-of-scope.md) in sync as each task lands.
