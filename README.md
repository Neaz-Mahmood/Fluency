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

Start the local database (needs Docker) and apply migrations. `DATABASE_URL` in `.env.example` already matches it.

```bash
pnpm db:up
pnpm db:migrate
```

Then run the app:

```bash
pnpm dev
```

Tests: `pnpm test` runs the unit tests. `pnpm test:db` runs the database tests against a separate `fluency_test` database (created and migrated automatically; needs `pnpm db:up`).

Other database scripts: `pnpm db:generate` (create a migration after changing `lib/db/schema.ts`), `pnpm db:studio` (browse data) and `pnpm db:down` (stop the database, keeping its data).

Open [http://localhost:3000](http://localhost:3000), then go to Practice. Speech recognition works in Chrome. Typing works in every browser.

Keys are read only on the server. The browser talks to `/api/chat`.

## What is built

- Phase 0: Next.js, TypeScript, Tailwind, shadcn/ui, and a streaming chat route for Claude or Google.
- Phase 1: scenario picker, Web Speech recognition, spoken replies, and a typed fallback.

Accounts, saved transcripts, and the post-conversation feedback pass are later phases and are not in this build.
# Fluency
