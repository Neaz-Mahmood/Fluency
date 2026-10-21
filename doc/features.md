# Features

Fluency is a voice-first practice partner for spoken English. You pick a scenario, speak or type, and an AI partner replies out loud in natural English.

## What is built

- **Phase 0** — Next.js 16 app with TypeScript, Tailwind v4, shadcn-style UI primitives, and a streaming chat route that can call Claude or Google.
- **Phase 1** — a scenario picker, browser-based speech recognition, spoken replies via the Web Speech API, and a typed fallback for browsers without a microphone.
- **Session history** — past conversations listed at `/history` and opened as read-only transcripts at `/history/[sessionId]`.
- **Language settings and onboarding** — Bangla-first onboarding at `/onboarding` to choose native language (`bn-BD`), and a language section in `/settings` to view or change it.
- **Placement chat** — a 6-question diagnostic conversation at `/placement` that estimates initial speaking and writing CEFR levels using the feedback model.
- **Bangla UI strings** — message dictionary providing Bangla UI strings for the home page, scenario picker, practice controls, transcripts, and client error messages when the learner's native language is `bn-BD`.
- **Latency logging** — server time to first token and client time to first audio are saved on every assistant turn in `session_turns`.
- **Evaluation harness** — `pnpm eval` scores a corrector against a golden set of Bangla-speaker sentences and reports over-correction.
- **Learner-aware prompt and summary** — the system prompt adapts to the learner's CEFR level and native language, and includes a short note about them that is rebuilt when they press "Switch scenario".

## Feature pages

| Area | Page |
| --- | --- |
| Scenario picker | [scenarios.md](./scenarios.md) |
| Hold-to-talk microphone | [voice-input.md](./voice-input.md) |
| Typed fallback | [typed-input.md](./typed-input.md) |
| Conversation lifecycle and status | [conversation.md](./conversation.md) |
| `POST /api/chat` | [api.md](./api.md) |
| AI provider selection and streaming | [ai-providers.md](./ai-providers.md) |
| Spoken replies (TTS) | [spoken-replies.md](./spoken-replies.md) |
| Placement chat | [placement.md](./placement.md) |
| Evaluation harness | [evaluation.md](./evaluation.md) |

## App shell

The home page (`app/page.tsx`) introduces the app, lays out a three-step explainer, and links to `/practice`. The practice route (`app/practice/page.tsx`) hosts the `<Conversation />` component. A sticky brand header and nav are rendered from `app/layout.tsx`. UI text comes from `lib/messages.ts` (English and Bangla), picked on the server from the learner's native language and passed down as a `messages` prop.

## What is not in this build

Accounts (sign-in), the post-conversation feedback pass and Spanish are later phases. See [out-of-scope.md](./out-of-scope.md) for the full list.
