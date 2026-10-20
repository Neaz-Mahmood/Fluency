# Fluency

A web app for practicing spoken English. You pick a scenario, speak or type, and a conversation partner replies out loud.

## Run

```bash
pnpm install
cp .env.example .env.local
```

Add one provider key to `.env.local`:

```
CLAUDE_API_KEY=your_claude_key
```

or

```
GOOGLE_API_KEY=your_google_key
```

If only one key is set, Fluency uses that provider. If both keys are set, choose one with `AI_PROVIDER=claude` or `AI_PROVIDER=google`. `ANTHROPIC_API_KEY` is accepted as the Claude key.

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), then go to Practice. Speech recognition works in Chrome. Typing works in every browser.

Keys are read only on the server. The browser talks to `/api/chat`.

## What is built

- Phase 0: Next.js, TypeScript, Tailwind, shadcn/ui, and a streaming chat route for Claude or Google.
- Phase 1: scenario picker, Web Speech recognition, spoken replies, and a typed fallback.

Accounts, saved transcripts, and the post-conversation feedback pass are later phases and are not in this build.
# Fluency
