# Live voice worker (FLU-59)

A long-running Node.js process using `@livekit/agents` that joins a learner's LiveKit room to run real-time spoken conversation practice.

## What it is

The voice worker is Fluency's live voice tutor backend. When a learner starts a voice session in the browser, LiveKit Cloud dispatches a job to this worker. The job connects to the session's WebRTC room, executes a low-latency speech pipeline (Deepgram Flux speech-to-text → Gemma 4 31B LLM → Cartesia Sonic-3 text-to-speech) entirely through LiveKit Inference, and persists each exchange to Postgres in the exact same format as text chat.

## Where it lives

- `worker/main.ts` — Agent definition, event handling (`ConversationItemAdded`), write queuing, and process lifecycle via `cli.runApp`.
- `worker/job.ts` — Pure helpers, constants (model IDs, voice IDs, thresholds), job metadata validation (`parseJobMetadata`), and turn/exchange buffering (`ExchangeCollector`).
- `worker/context.ts` — Database context loader (`loadVoiceContext`): queries learner profile, due review cards, active error patterns, and existing session history.
- `worker/resolve-hook.ts` — Node module resolution hook enabling `@/` imports and `.ts` extension resolution in plain Node.
- `scripts/voice/call.ts` — Scripted test participant for exercising the worker end-to-end with WAV files without needing a browser.

## How it works

### Metadata contract

The job metadata is a JSON string. `POST /api/voice/token` signs it into the learner's token as a room configuration dispatch (`RoomConfiguration` with `RoomAgentDispatch`), and the agent is dispatched when the learner joins. `pnpm voice:call` dispatches with `AgentDispatchClient` instead.

```ts
export type VoiceJob = {
  learnerId: string;
  scenarioId: ScenarioId;
  sessionId: string | null;
};
```

`parseJobMetadata` validates this JSON payload:

- `learnerId` must be a valid UUID corresponding to an existing row in `learner_profiles`.
- `scenarioId` must be one of the known scenarios (`"free-chat"`, `"job-interview"`, `"cafe"`, `"neighbor"`).
- `sessionId` is optional. If provided, it must be a valid UUID. If omitted or `null`, `sessionId` is `null`.

### From the browser

1. **Token route & access checks:** `POST /api/voice/token` verifies the learner's consent and today's quota (Dhaka time). If refused, it responds with 403 `consent`, 429 `quota`, or 404 `session`. When unavailable or unconfigured, it returns 503 `unavailable`. On success, it issues a signed token dispatched to `fluency-tutor` with 200 `{ url, token, remainingSeconds }`.
2. **Session ID announcement:** When the worker creates a new session in Postgres upon saving the first exchange, it sets the `fluency.session_id` attribute on its participant. The browser adopts this session ID into URL search parameters (`?session=`) so page reloads and the "Finish and get feedback" flow preserve the conversation.
3. **Transcript streams to turns:** All text arrives as text streams on the `lk.transcription` topic. The learner's speech arrives as streams with `lk.transcription_final: "false"` for interim updates and `"true"` for final turns. Agent replies arrive as deltas within a stream and are accumulated into an assistant turn in real-time.
4. **Input exclusivity & fallback:** While live voice is active, the hold-to-talk button, hands-free toggle, and typed input are disabled to prevent conflicting inputs. When live voice is off, unavailable, or refused, Web Speech hold-to-talk and typing remain available as fallbacks.

### Pipeline and models

All models run through **LiveKit Inference**, requiring only `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`:

| Stage | Model / Component          | Configuration                                                          | Notes                                                          |
| ----- | -------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| STT   | `deepgram/flux-general-en` | `eager_eot_threshold: 0.5`                                             | Enables eager end-of-turn detection for preemptive generation. |
| LLM   | `google/gemma-4-31b-it`    | Prompt from `getSystemPrompt` in `lib/prompts.ts`                      | Fastest time to first token (~426 ms p50).                     |
| TTS   | `cartesia/sonic-3`         | Voice `f786b574-daa5-4673-aa0c-cbe3e8534c02` (Katie), `language: "en"` | Katie voice reproduces mixed English and Bangla help cleanly.  |

Turn handling enables preemptive generation (`turnHandling: { preemptiveGeneration: { enabled: true } }`), drafting model replies on eager end-of-turn signals to cut latency. The 750 ms target isn't met yet: the 2026-10-26 prototype measured about 1.6 s end to end on a warm turn (FLU-63 tunes it).

### Exchange collection and database persistence

The worker listens for `voice.AgentSessionEventTypes.ConversationItemAdded` events:

1. `ExchangeCollector` buffers incoming user transcript messages (`role: "user"`). If Flux emits multiple segments before a reply, they are joined with spaces.
2. When the assistant message arrives (`role: "assistant"`), `ExchangeCollector.add` pairs the buffered user text with the assistant reply and extracts TTFT from metrics (`llmNodeTtft`).
3. To maintain strict turn ordering without races, saves are chained serially on a promise chain (`saving = saving.then(() => save(exchange))`).
4. If `sessionId` is `null`, the session is created on demand in Postgres (`startSession`) when the first turn is saved. Voice sessions that terminate without any spoken turns leave no database rows.
5. Turns are saved via `saveExchange(db, { sessionId, userText, inputMode: "voice", replyText, replyTurnId, firstTokenMs })`.
6. For assistant messages, latency metrics (`endOfTurnDelay`, `llmNodeTtft`, `ttsNodeTtfb`, `e2eLatency`) are logged to stdout prefixed with `[voice]`.
7. `ctx.addShutdownCallback` flushes any remaining buffered user turn and awaits all in-flight database saves before disconnecting.

### How to run

Run the worker:

```bash
# Development: registers with LiveKit Cloud from this machine
pnpm voice:worker dev

# Production worker
pnpm voice:worker start
```

Run a scripted call test:

```bash
pnpm voice:call --learner <uuid> [--scenario cafe] [--session <uuid>] <turn1.wav> [<turn2.wav> ...]
```

The script joins the room, streams 10 ms PCM audio frames to simulate microphone input, provides 8 seconds of silence for the agent to reply after each turn, logs transcriptions, and exits gracefully.

## Notes

- **No recording:** `session.start` passes `record: false`. By default, LiveKit Agents writes the session audio to `audio.ogg` in the OS temp folder and uploads audio, transcript and traces to LiveKit Cloud. Fluency stores no raw audio.
- **No greeting:** In alignment with text conversation mode, the tutor does not greet first; the learner speaks first.
- **English-only STT:** Deepgram Flux general English is used. Spoken Bangla words in A1/A2 turns may be dropped or turned into English-sounding guesses. FLU-68 tests this against `deepgram/flux-general-multi`.
- **Enforcement hooks:** Quota limits and consent checks are verified when requesting a token (`POST /api/voice/token`). Quota is only checked when a session starts; nothing meters or cuts off a running session until task 11 (FLU-61).
- **Finish delay shortcut:** The 1.5 s wait before finishing a live session is a temporary shortcut to give the worker time to persist the final exchange before recap generation.
- **Database connectivity & deployment:** The worker requires direct Postgres database access. As a result, it cannot be deployed to LiveKit Cloud until a managed Postgres database reachable from the cloud worker is configured (FLU-67).
