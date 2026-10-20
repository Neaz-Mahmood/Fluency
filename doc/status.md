# Status and next work

Where Fluency stands today and what to work on next. The long-range plan is in [roadmap.md](./roadmap.md). This page turns its next steps into concrete tasks against the current code.

Last checked: 2026-10-20.

## What it is

A snapshot of the app's health, the gaps between the current code and the roadmap's Phase 2, and an ordered task list: housekeeping first (Week 0), then Phase 2 (Weeks 1–3).

## Current status

### Built and working (Phases 0–1)

| Area | State | Where |
| --- | --- | --- |
| App shell, home page, practice route | Working | `app/layout.tsx`, `app/page.tsx`, `app/practice/page.tsx` |
| Four scenarios | Working | `lib/scenarios.ts`, `components/ScenarioPicker.tsx` |
| Streaming chat with Claude or Gemini | Working | `app/api/chat/route.ts`, `lib/anthropic.ts`, `lib/google.ts`, `lib/provider.ts` |
| Request validation (alternating turns, max 40 turns, max 2,000 chars per message) | Working | `lib/chat-request.ts` |
| Hold-to-talk and hands-free voice input (Web Speech, Chrome) | Working | `lib/stt.ts`, `components/Conversation.tsx` |
| Spoken replies, split into sentences (Web Speech) | Working | `lib/tts.ts` |
| Typed fallback | Working | `components/Conversation.tsx` |
| Implicit correction (the partner rephrases unclear English) | Working, in the prompt only | `lib/prompts.ts` |

### Health checks

| Check | Result |
| --- | --- |
| `tsc --noEmit` | Passes |
| `eslint .` | Passes, no warnings |
| `next build` | Passes. `/api/chat` is dynamic; `/` and `/practice` are static. |
| Automated tests | `pnpm test`: 23 Vitest tests covering request validation and provider selection |
| Version control | Git, pushed to GitHub. Feature work happens on `feat/v1`. |

### Gaps and risks in the current code

1. ~~**No version control.**~~ Fixed: the repo is in git and on GitHub.
2. **`/api/chat` is open.** Login is built last (end of Phase 5), so the route stays open until then. Run the app locally, or set the optional `ACCESS_CODE` gate (Week 1) before deploying it anywhere testers can reach. Otherwise anyone with the URL can spend the API key.
3. ~~**Two lockfiles.**~~ Fixed: pnpm only.
4. ~~**No tests.**~~ Fixed for the pure server modules. The UI and the streaming route still have no tests.
5. **Everything is in memory.** Transcripts live in `Conversation` component state and disappear on reload. The learner model, flashcards and the recap all depend on saved transcripts.
6. **No latency numbers.** Phase 4's p50/p90 gate needs a baseline, and nothing is measured today.
7. **Hard-coded English.** `lang = "en-US"` in `lib/stt.ts` and `lib/tts.ts`, and an English-only UI. That's fine for es → en as long as the native language is stored, but A1 learners need Spanish UI text.
8. **The prompt is the same for every learner.** `getSystemPrompt(scenarioId)` has no input for CEFR level or a learner summary.
9. **`components/Conversation.tsx` is 448 lines** and has raw hex colors instead of the design tokens in `DESIGN.md`. It's not blocking, but Phase 2 adds session saving and Phase 4 replaces the audio layer here, so split it before it grows.
10. **Web Speech recognition only works fully in Chrome.** Phase 4 replaces it. Until then, the typed fallback covers other browsers.

## What to work on

Tasks are in order. Each one lists the files it touches and what "done" means.

### Week 0 — Housekeeping (1–2 days)

- [x] **Set up git.** Done: the repo is on GitHub (`origin/main`), `.env` is ignored and not committed, and work continues on `feat/v1`.
- [x] **Pick one package manager.** Done: pnpm (`packageManager: pnpm@11.25.0`). `package-lock.json` is deleted and `README.md` uses `pnpm install` / `pnpm dev`.
- [x] **Add a test runner.** Done: Vitest (`vitest.config.mts`) with `pnpm test` and `pnpm test:watch`. `lib/chat-request.test.ts` and `lib/provider.test.ts` cover every error branch (23 tests). The config stubs `server-only` so server modules can be imported in tests.
- [x] **Choose the Postgres host and database library.** Done: Postgres + Drizzle, running locally in Docker (`docker-compose.yml`, `pnpm db:up`). The managed host for test deploys gets picked at first deploy (Neon or Supabase). See [roadmap.md](./roadmap.md#open-decisions). Login (email/password and Google) is built last, in Phase 5, so the auth library can wait. It must work with whatever database you pick here.

Done when: the repo has history, `pnpm test` passes, and the database is chosen.

### Phase 2 — Weeks 1–3: Learner model and measurement

#### Week 1: Anonymous learners and the database

- [x] **Schema and migrations.** Done: all seven tables in `lib/db/schema.ts`, migration `drizzle/0000_learner_schema.sql`, client in `lib/db.ts`. Every table cascades from `learner_profiles`. `native_language` and the CEFR levels stay null until onboarding and placement.
- [ ] **Anonymous learner ID.** A server-only `lib/learner.ts` that reads the `learner_id` cookie (httpOnly, `SameSite=Lax`, `Secure` in production), or creates a `learner_profiles` row and sets the cookie if there isn't one. `/api/chat` and every later data route get the learner from here, never from the request body. This is the only place Phase 5 login has to change.
- [ ] **Delete my data.** A settings action that deletes the learner row (cascading through every table) and clears the cookie. Add a test that checks no rows remain.
- [ ] **Optional `ACCESS_CODE` gate.** In `proxy.ts`, if `ACCESS_CODE` is set, require it once (stored in a cookie) before serving `/practice` and `/api/chat`. Skip this while running only on localhost. Next.js 16 renamed `middleware` to `proxy`; see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.

Done when: a first visit creates exactly one learner row, a reload reuses it, and deleting your data leaves no rows behind.

#### Week 2: Saved sessions and measurement

- [ ] **Save sessions.** Create a `sessions` row when a scenario is picked. In `app/api/chat/route.ts`, save the user turn and the full assistant reply after the stream finishes, using `after()` from `next/server` so saving never delays the reply.
- [ ] **Load from the database.** Read history from the database instead of trusting the client's `messages` array. Keep `parseChatRequest` for validating the new turn.
- [ ] **Session history page.** List past sessions and open a read-only transcript.
- [ ] **Latency logging.** Server: time to first token per turn in `route.ts`. Client: time from send to `speakText` `onStart` in `Conversation.tsx`. Store both per turn in `session_turns`.
- [ ] **Split `Conversation.tsx`.** Move the audio and turn state machine into a hook (for example `useConversation`) and keep the component for layout. Replace raw hex values with `DESIGN.md` tokens while you're there.
- [ ] **Evaluation harness skeleton.** A `scripts/eval` entry point, a golden-set file format (`input`, `expected_edits`, `is_error_free`) and a report of over-correction rate and edit counts. It can start with 10 hand-written sentences.

Done when: a reload shows the same conversation, every turn has latency numbers, and `pnpm eval` prints a report.

#### Week 3: Learner model and placement

- [ ] **Language settings.** Native language (`es`) and target language (`en-US`) on `learner_profiles`, chosen during onboarding.
- [ ] **Spanish UI strings.** A small message dictionary for the home page, the scenario picker, the practice controls and error messages (including the messages in `lib/stt.ts`), picked by the native-language setting.
- [ ] **Placement chat.** A `placement` mode, separate from the four scenarios, that asks at most 6 questions and then makes one structured call to the feedback model to set provisional `cefr_speaking` and `cefr_writing`.
- [ ] **Learner summary.** After a session ends, use `after()` to build `compact_tutor_summary` (under 250 tokens) from the profile and transcript. Change `getSystemPrompt(scenarioId)` to `getSystemPrompt(scenarioId, learner)` so it includes CEFR level, native language and summary.
- [ ] **Level-aware prompt rules.** Add the A1–A2 / B1 / B2+ rules from the research to `lib/prompts.ts`, keeping the current "no lecture, no correction lists" rules.

Done when: a new learner completes placement, finishes one session, and their next session's system prompt includes their level and a summary under 250 tokens (checked on 20 test profiles).

### Phase 2 exit check

- [ ] Transcripts persist across reloads in the same browser.
- [ ] Placement finishes in 6 turns or fewer.
- [ ] The summary stays under 250 tokens on 20 test profiles.
- [ ] "Delete my data" leaves no rows (test passes).
- [ ] Latency is logged on every turn, and a baseline p50/p90 is written into this page.

## After Phase 2

Phases 3–5 are in [roadmap.md](./roadmap.md). Login (email/password and Google) is the last part of Phase 5. Before starting Phase 3, update this page: move finished items into **Current status**, and break Phase 3 into weekly tasks the same way.

## Notes

- The background worker the roadmap mentions is only required in Phase 4, when the voice agent needs a long-lived process. In Phase 2, `after()` in route handlers is enough for saving turns and building summaries.
- Read `node_modules/next/dist/docs/` before using any Next.js API. This is Next.js 16, and some conventions differ from older versions; `proxy.ts` replacing `middleware.ts` is one example.
- Keep [features.md](./features.md) and [out-of-scope.md](./out-of-scope.md) in sync as each task lands.
