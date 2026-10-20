# Fluency — Feature Documentation

This directory documents the features that are built into Fluency, the spoken-English practice app. For run/setup instructions, see the top-level `README.md`. For visual design tokens, see the top-level `DESIGN.md`.

## Index

- [Features overview](./features.md) — what the app does, in one page.
- [Scenarios](./scenarios.md) — the four practice scenarios.
- [Voice input](./voice-input.md) — hold-to-talk mic and Web Speech recognition.
- [Typed input](./typed-input.md) — text fallback when the mic is unavailable.
- [Conversation](./conversation.md) — turn lifecycle, status state machine, transcript.
- [API](./api.md) — `POST /api/chat` and request validation.
- [AI providers](./ai-providers.md) — Claude and Google Gemini streaming.
- [Spoken replies](./spoken-replies.md) — sentence-chunked speech synthesis.
- [Out of scope](./out-of-scope.md) — features planned for later phases.
- [Roadmap](./roadmap.md) — the 12-week plan for Phases 2–5.
- [Status and next work](./status.md) — current health of the app and the ordered task list.

## How to read these

Each per-feature file follows the same shape:

- **What it is** — one paragraph in plain language.
- **Where it lives** — the source files that implement it.
- **How it works** — behavior, constants, and edge cases.
- **Notes** — browser support, env-var requirements, and other caveats.

Source paths are written in code fences (for example `` `lib/stt.ts` ``) and are relative to the repository root.
