# Features

Fluency is a voice-first practice partner for spoken English. You pick a scenario, speak or type, and an AI partner replies out loud in natural English.

## What is built

- **Phase 0** — Next.js 16 app with TypeScript, Tailwind v4, shadcn-style UI primitives, and a streaming chat route that can call Claude or Google.
- **Phase 1** — a scenario picker, browser-based speech recognition, spoken replies via the Web Speech API, and a typed fallback for browsers without a microphone.
- **Session history** — past conversations listed at `/history` and opened as read-only transcripts at `/history/[sessionId]`.

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

## App shell

The home page (`app/page.tsx`) introduces the app, lays out a three-step explainer, and links to `/practice`. The practice route (`app/practice/page.tsx`) hosts the `<Conversation />` component. A sticky brand header and nav are rendered from `app/layout.tsx`.

## What is not in this build

Accounts, saved transcripts, and the post-conversation feedback pass are later phases. See [out-of-scope.md](./out-of-scope.md) for the full list.
