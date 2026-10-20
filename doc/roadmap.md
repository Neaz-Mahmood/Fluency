# Roadmap

This is the plan for the next 12 weeks of Fluency. It revises the MVP plan in `AI Language Fluency App Research.pdf` to fit the app that already exists and to fix gaps in the original plan.

## What it is

A four-phase plan that takes Fluency from a stateless web app for practicing English to an MVP with accounts, post-session feedback, flashcards, a low-latency voice tutor with pronunciation scoring, and role-plays. Phases 0 and 1 are already built (see [features.md](./features.md)), so this plan starts at Phase 2.

## Ground rules

These decisions apply to every phase. They are the main ways this plan differs from the research plan.

- **Web first, in the existing Next.js app.** No Expo rewrite during the MVP. Browsers already do echo cancellation (`getUserMedia({ echoCancellation: true })`), and LiveKit has a browser SDK. Mobile comes after the MVP.
- **One learning direction: Spanish speakers learning English (es → en).** This matches the current English-only app and halves the golden sets, the pronunciation rules and the content work. English speakers learning Spanish (en → es) comes after the MVP.
- **The live turn only talks; feedback happens after the session.** The fast model in the voice loop writes the reply and nothing else. Grammar correction runs on the saved transcript with the feedback model (`CLAUDE_MODELS.feedback` in `lib/anthropic.ts`). This keeps latency low and puts correction on a model strong enough to do it with high precision.
- **Correct only real errors (precision first).** Never set a target error count in a prompt. At least 40% of few-shot examples are error-free and map to `edits: []`. Every correction has two tracks: `minimal_correction` (only real errors) and `fluency_upgrade` (optional, labeled as style).
- **Measure from week 1.** The evaluation harness and latency tracking ship in Phase 2, not later. Each phase gate below assumes they exist.
- **Costs and compliance ship with the feature that creates them.** The voice quota ships with voice. Consent ships before audio is stored. Account deletion ships with the schema.
- **Test vendors before relying on their numbers.** The text-to-speech ranking in the research comes from one vendor's own site, and the over-correction numbers come from Finnish and Ukrainian correction papers. Phase 4 starts by testing both on our own data.

## Phase 2 — Weeks 1–3: Accounts, learner model, measurement

Fluency remembers who you are and what you said.

### Engineering

- Accounts with sign-up and sign-in. Every later feature needs a user.
- Managed Postgres with the four tables from the research (`learner_profiles`, `learner_error_patterns`, `fsrs_cards`, `fsrs_review_logs`), plus:
  - a `user_id` link from `learner_profiles` to the auth user;
  - `sessions` and `session_turns` tables for saved transcripts;
  - a `voice_usage` table keyed by `(learner_id, day)`. This replaces `daily_free_voice_seconds_used`, which has no reset date.
- Delete account: one action that cascades through every learner table. The schema's `ON DELETE CASCADE` makes this cheap now and expensive to add later.
- Background jobs (saving turns, building summaries) run in `after()` from `next/server`. A separate long-running worker is only needed in Phase 4, for the voice agent.
- Latency tracking on the existing `/api/chat` path: time to first token and time to first audio, logged per turn.
- Evaluation harness skeleton: a script that runs prompts against a golden set and reports scores. It must exist before any correction prompt does.

### Learning and AI

- Language settings: native language `es` and target language `en-US`. Only the A1–A2 explanations use the native language.
- Spanish UI strings for the basic screens, so A1 learners can find their way around.
- Placement chat (6 turns or fewer) that sets a **provisional** speaking and writing CEFR level. Reading and listening start at the speaking level and are refined from real sessions. A chat can't measure them directly.
- Compact learner summary (under 250 tokens) built by the worker after each session and added to the system prompt from `lib/prompts.ts`.

### Exit gate

- Transcripts persist across reloads and devices.
- Placement finishes in 6 turns or fewer and writes a CEFR level.
- The learner summary stays under 250 tokens on 20 test profiles.
- Delete account removes every row for that learner (checked by a test).

## Phase 3 — Weeks 4–6: Post-session feedback, flashcards, writing

Fluency tells you what to fix, without false alarms, and helps you remember it.

### Engineering

- Post-session feedback job in the worker, run on the saved transcript with the feedback model:
  1. Detect errors word by word and tag them with ERRANT codes (`R:VERB:TENSE`, `M:DET`, …).
  2. Correct only the flagged spans.
  3. Return `minimal_correction`, optional `fluency_upgrade`, `l1_interference_cause` and `explanation_for_recap`.
- Upsert results into `learner_error_patterns` (`occurrence_count`, `resolved_streak`).
- `ts-fsrs` with `request_retention: 0.9`, `maximum_interval: 365`, `enable_fuzz: true`, `enable_short_term: true`, `learning_steps: ['1m', '10m']`, `relearning_steps: ['10m']`. Every learner starts on the default FSRS-6 weights.
- es → en golden set: at least 200 learner sentences with at least 30% error-free, built from real Phase 2 transcripts where possible.

### Learning and AI

- End-of-session recap screen: the learner's sentence, the minimal fix and the fluency upgrade side by side, with the upgrade labeled "optional, your version was correct" when it is.
- Tap to save a word or correction from the recap into flashcards.
- Flashcard reviews use a fresh AI-written example sentence each time.
- Automatic grading by response time, with **separate thresholds for typed and spoken answers**. Start with the research values (<4 s Easy, 4–10 s Good, >10 s or the right root in the wrong form Hard, wrong Again), then adjust them to each learner's median after about 30 reviews.
- Writing coach for emails and short paragraphs, using the same correction pipeline.

### Exit gate

- Over-correction rate on error-free golden sentences **below 5%**. This blocks release.
- ERRANT F0.5 recorded as a baseline and tracked on every prompt change. It is not a fixed target: the best result the research reports for a prompted model is 49.37%, so a ≥ 0.50 target would be above the best published result.
- The CI run of the evaluation harness fails the build if over-correction goes up.

## Phase 4 — Weeks 7–9: Live voice tutor and pronunciation

Talk to Fluency with replies under a second, and get pronunciation feedback afterward.

### Week 7 first: tests before building

- **Text-to-speech A/B test** on our own English sentences and mixed English–Spanish sentences: Cartesia Sonic-3, Gradium, Deepgram Aura-2. Measure perceived time to first audio, including leading silence, plus pronunciation quality and cost.
- **Live model time to first token**: compare `claude-haiku-5-5` with the current Gemini Flash model. Check current prices; don't reuse the research figures.
- **Azure pronunciation assessment language check**: confirm which features (prosody, content scoring) work for `en-US` unscripted speech. The MVP only needs `en-US`, but write the result down for en → es later.
- **Choose the voice path.** If building solo: LiveKit Cloud with the Deepgram Voice Agent API. If two or more engineers: our own agent in the worker (Deepgram Flux speech-to-text → fast model → the text-to-speech vendor chosen above).

### Engineering

- Browser audio over WebRTC through LiveKit, replacing Web Speech for voice turns. Keep `lib/stt.ts` / `lib/tts.ts` as a fallback, and keep the typed fallback.
- The voice agent runs in the worker, not in a Next.js route. WebRTC sessions are long-lived.
- The voice is chosen **in code from the CEFR level**, not from a field in the model's output. The model's text has to reach text-to-speech before a trailing JSON field could be read.
- Copy each learner turn's audio to an Azure pronunciation job (16 kHz, 16-bit mono PCM, `Granularity.Phoneme`, prosody on). Gather at least 20 s / 50 words / 3 sentences before scoring. The live turn never waits on Azure.
- **Voice quota ships here**: a per-day counter in `voice_usage`, checked when a session starts and on every turn. Add Redis only if Postgres can't keep up.
- **Audio consent ships here**: explicit opt-in before any raw audio is stored. Audio is never sent to voice-cloning endpoints. Deleting an account also deletes stored audio.

### Learning and AI

- Live prompt rules: never interrupt; correct implicitly by modeling the right form in the reply; replies of 1–3 sentences and 45 words at most; ask a follow-up that invites the learner to use a due flashcard or a recurring error pattern.
- The recap adds pronunciation: words with `AccuracyScore` below 60, the top `NBestPhonemes`, and fluency and prosody scores. The feedback model turns these into friendly tips.
- es → en pronunciation patterns to look for: /ɪ/–/iː/ and /æ/–/ɑ/ merging, adding /e/ before s + consonant ("Spain" → [espeɪn]), final voiced stops devoiced, /ʃ/ → [tʃ], /ð/ → [d], clear [l] instead of dark [ɫ] at the end of a syllable, final /ŋ/ → [n].

### Exit gate

- Time from the end of the learner's speech to the first reply audio: **p50 < 750 ms, p90 < 950 ms**, measured in the browser over a real network.
- Zero voice turns blocked on pronunciation scoring.
- Quota and consent checked by tests.

## Phase 5 — Weeks 10–12: Role-plays, Gentle Mode, launch

Fluency becomes a product you can open every day.

### Engineering

- Role-play state machine with goals (`criteria_met_count` / `criteria_total_count`), built on top of `lib/scenarios.ts`.
- Free tier and paid tier gating on top of the Phase 4 quota.
- Progress view: CEFR level over time and resolved error streaks.

### Learning and AI

- **10** CEFR-mapped role-plays at launch: the current 4 plus doctor visit, coworker small talk, phone call, hotel check-in, asking for directions and returning an item. 20+ is a post-launch goal.
- Role-play grading by key-point coverage, feeding FSRS: <40% Again, 40–69% Hard, 70–94% Good, 95%+ Easy, where Easy also needs Azure word `AccuracyScore` ≥ 75.
- Gentle Mode: text-to-speech at 0.85×, a text-first view, and a "How do I say…" drawer that answers in the native language.
- Stretch: graded stories with cached audio, keyed by `(target_language, cefr_level, topic_slug)` and voiced with low-cost batch text-to-speech.

### Exit gate

- The free-tier cap holds under a load test.
- Account deletion and audio deletion verified end to end.
- Cost per 10-minute voice session measured in production and compared with the research's estimate of $0.14–$0.27.

## After the MVP

- en → es direction: Spanish golden set, en → es pronunciation patterns (tap /ɾ/ vs. trill /r/, dropped final /r/, aspirated stops, missing [β ð ɣ], /ɲ/ split into /n+j/, diphthongs split into two syllables), and the bilingual code-switching voice.
- Expo mobile app.
- `en-GB` and `es-MX` / `es-ES` variants.
- Per-learner FSRS weight optimization once review history is large enough.
- COPPA compliance, only if children become an audience. Until then, require users to be 13 or older.

## Open decisions

These are choices the plan doesn't make. Each one needs an owner before the phase it affects.

| Decision | Default in this plan | Needed by |
| --- | --- | --- |
| Free-tier size. The research says both "three 5-minute sessions" (15 min) and "5 minutes/day". | 5 minutes/day, as three short sessions of 4 turns | Phase 4 |
| Auth provider and Postgres host | Any managed option that works with Next.js | Phase 2, week 1 |
| Team size, which sets the voice path | Solo path (LiveKit Cloud + Deepgram Voice Agent) | Phase 4, week 7 |
| Text-to-speech vendor | Decided by the week 7 A/B test | Phase 4, week 7 |

## Notes

- Model ids, prices and benchmark figures here come from the research (October 2026) and should be checked again when each phase starts.
- When a phase ships, update [features.md](./features.md), add per-feature pages, and trim [out-of-scope.md](./out-of-scope.md).
