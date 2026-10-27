# Fluency

A web app for practicing spoken English, built first for Bangla speakers. You pick a scenario, speak or type, and a conversation partner replies out loud. After each session you get feedback, flashcards for review, and a pronunciation score when you use live voice.

What is built so far and what comes next: [doc/status.md](doc/status.md) and [doc/roadmap.md](doc/roadmap.md).

## Requirements

- Node.js 26 (the voice worker runs TypeScript directly with Node's type stripping)
- pnpm 11 (`packageManager` in `package.json` pins the version)
- Docker, for the local database
- Chrome, for browser speech recognition. Typing works in every browser.
- For live voice: a LiveKit Cloud project and an Azure Speech resource. To deploy the worker: the `lk` CLI (`brew install livekit-cli`).

## Setup

```bash
pnpm install
cp .env.example .env
```

Use `.env`, not `.env.local`: the `voice:*` scripts and the voice worker read only `.env`. Next.js and Drizzle read both.

### Environment variables

| Variable                                                 | Needed for                         | Notes                                                                                                                                                                                           |
| -------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE_API_KEY`, `GOOGLE_API_KEY` or `OPENCODE_API_KEY` | Chat, feedback, placement, writing | Set at least one. With only one set, Fluency uses that provider. With more than one, pick with `AI_PROVIDER=claude`, `google` or `opencode`. `ANTHROPIC_API_KEY` is accepted as the Claude key. |
| `DATABASE_URL`                                           | Everything                         | The value in `.env.example` matches the local Docker database.                                                                                                                                  |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`   | Live voice                         | From your LiveKit Cloud project. The speech and language models run through LiveKit Inference with these keys, so there is no Deepgram key.                                                     |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`                | Pronunciation scoring              | Use a region near Bangladesh, such as `southeastasia`. Without them, live voice works but turns aren't scored.                                                                                  |
| `CARTESIA_API_KEY`, `GRADIUM_API_KEY`                    | `pnpm voice:tts-ab` only           | The text-to-speech A/B test. The app doesn't need them.                                                                                                                                         |

Keys are read only on the server.

### Local database

Start Postgres in Docker and apply the migrations:

```bash
pnpm db:up
pnpm db:migrate
```

Other database scripts:

- `pnpm db:generate`: create a migration after changing `lib/db/schema.ts`
- `pnpm db:studio`: browse the data
- `pnpm db:down`: stop the database, keeping its data

## Run the app

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). A new learner goes through onboarding and a short placement chat, then reaches Practice, History, Review (flashcards), Write and Settings.

## Live voice

Live voice is real-time spoken conversation through LiveKit. The browser gets a token from `POST /api/voice/token`, and a separate worker process (`worker/main.ts`) joins the room. The worker runs speech-to-text, the language model and text-to-speech, saves the turns, meters each learner's 5 minutes a day (Bangladesh time) and scores pronunciation. Details are in [doc/voice-worker.md](doc/voice-worker.md).

To use it locally:

1. Set the `LIVEKIT_*` and `AZURE_*` variables in `.env`.
2. Start the worker in a second terminal. It registers with LiveKit Cloud from your machine:
   ```bash
   pnpm voice:worker dev
   ```
3. In the app, agree to live voice in Settings, then press **Start live voice** on the Practice page.

While a local `dev` worker is running, LiveKit can send sessions to it instead of the deployed worker, because both register under the same name (`fluency-tutor`). Stop it when you want to test the deployed one.

### Voice scripts

| Script                                                                              | What it does                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm voice:call --learner <uuid> [--scenario cafe] [--session <uuid>] a.wav b.wav` | Joins a room as a scripted learner and plays each WAV file as a turn. The learner must exist in the database the worker uses and must have agreed to live voice.                       |
| `pnpm voice:latency [--since YYYY-MM-DD] [--learner <uuid>]`                        | Reports p50 and p90 from the end of speech to the first reply audio, measured in the browser, against the gate (p50 < 750 ms, p90 < 950 ms). It needs at least 20 turns for a verdict. |
| `pnpm voice:ttft`                                                                   | Benchmarks time to first token for the language model candidates.                                                                                                                      |
| `pnpm voice:tts-ab`                                                                 | The text-to-speech A/B test.                                                                                                                                                           |
| `pnpm voice:azure`                                                                  | Scores a recording with Azure pronunciation assessment.                                                                                                                                |

## Tests and evaluation

- `pnpm test`: unit tests
- `pnpm test:db`: database tests, run against a separate `fluency_test` database. It's created and migrated automatically, but needs `pnpm db:up` first.
- `pnpm eval`: scores the corrector against `scripts/eval/golden/bn-en.json` ([doc/evaluation.md](doc/evaluation.md))
- `pnpm lint` and `pnpm format`

## Deployment

### Database: Supabase

The managed database is Supabase Postgres in Mumbai (`ap-south-1`). Connect through the **Session pooler** (`aws-0-ap-south-1.pooler.supabase.com:5432`, user `postgres.<project-ref>`). The direct host `db.<ref>.supabase.co` has only an IPv6 address, so LiveKit Cloud can't reach it. Session mode supports the prepared statements the app uses.

The Supabase Data API is turned off. The app connects only as `postgres`, and the tables have no row-level security, so leave it off.

Keep the Supabase URL in `.env.supabase` at the repo root. It's gitignored by the `.env*` rule, so `.env` can stay pointed at the local database. Percent-encode `@ : / ? # %` in the password.

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
```

To run migrations against Supabase, pass the URL in through the environment. `drizzle.config.ts` doesn't override a `DATABASE_URL` that is already set.

```bash
node --env-file=.env.supabase -e "require('child_process').execFileSync('pnpm',['db:migrate'],{stdio:'inherit'})"
```

### Voice worker: LiveKit Cloud

The worker is deployed as a LiveKit Cloud agent in region `ap-south` (Mumbai), the same AWS region as the database. `livekit.toml` holds the project and the agent ID, and `Dockerfile` builds the image. There is no build step, and `.dockerignore` keeps `.env*` files out of the upload.

`lk` reads `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from the environment, so you can skip `lk cloud auth` by exporting them from `.env`:

```bash
set -a; source .env; set +a

lk agent deploy      # upload, build on LiveKit Cloud, and roll out a new version
lk agent status      # should show Running
lk agent logs        # add --log-type=build for the build logs
lk agent secrets     # list secret names
```

The agent needs three secrets: `DATABASE_URL` (the Supabase pooler URL), `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`. LiveKit Cloud provides the `LIVEKIT_*` variables itself. To change the secrets, write them to a file outside the repo, one `KEY=value` per line. Then apply the file and delete it:

```bash
lk agent update-secrets --secrets-file /path/to/agent-secrets.env   # restarts the agent
```

To set up the agent from scratch, which creates a new `livekit.toml`:

```bash
lk agent create --region ap-south --secrets-file /path/to/agent-secrets.env .
```

To check a deploy end to end, stop any local `pnpm voice:worker dev`. Then run `pnpm voice:call` with a learner that exists in Supabase and has voice consent. The turns, voice usage and pronunciation scores should appear in Supabase.

### Web app

The Next.js app isn't deployed yet. When it is, set the same variables as `.env`, with `DATABASE_URL` pointing at the Supabase pooler URL. There is no login until Phase 5, so anyone with the URL can use the AI provider key.
