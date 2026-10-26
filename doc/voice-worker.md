# Live voice worker (FLU-59)

A long-running Node.js process using `@livekit/agents` that joins a learner's LiveKit room to run real-time spoken conversation practice.

## What it is

The voice worker is Fluency's live voice tutor backend. When a learner starts a voice session in the browser, LiveKit Cloud dispatches a job to this worker. The job connects to the session's WebRTC room, executes a low-latency speech pipeline (Deepgram Flux speech-to-text → Gemma 4 31B LLM → Cartesia Sonic-3 text-to-speech) entirely through LiveKit Inference, and persists each exchange to Postgres in the exact same format as text chat.

## Where it lives

- `worker/main.ts` — Agent definition, event handling (`ConversationItemAdded`), write queuing, and process lifecycle via `cli.runApp`.
- `worker/job.ts` — Pure helpers, constants (model IDs, voice IDs, thresholds), job metadata validation (`parseJobMetadata`), and turn/exchange buffering (`ExchangeCollector`).
- `worker/context.ts` — Database context loader (`loadVoiceContext`): queries learner profile, due review cards, active error patterns, and existing session history.
- `worker/pronunciation.ts` — Azure pronunciation scoring and the copy of the learner's audio (`ScoringAgent`).
- `worker/turn-audio.ts` — Cutting each learner turn out of that audio (`TurnAudioBuffer`).
- `worker/resolve-hook.ts` — Node module resolution hook enabling `@/` imports and `.ts` extension resolution in plain Node.
- `scripts/voice/call.ts` — Scripted test participant for exercising the worker end-to-end with WAV files without needing a browser.
- `scripts/voice/latency.ts` — Live voice latency report (`pnpm voice:latency`) measuring speech-end-to-first-audio against the gate.

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

Katie's speed follows the learner's listening level, falling back to the speaking level (`ttsSpeedForLevel` in `worker/job.ts`): A1 0.8, A2 0.9, B1 and up 1.0, and 0.9 before placement. The voice is the same at every level.

Turn handling enables preemptive generation (`turnHandling: { preemptiveGeneration: { enabled: true } }`), drafting model replies on eager end-of-turn signals to cut latency. The 750 ms target isn't met yet: the 2026-10-26 prototype measured about 1.6 s end to end on a warm turn. The browser measurement (see Latency) is the number the gate uses.

### Exchange collection and database persistence

The worker listens for `voice.AgentSessionEventTypes.ConversationItemAdded` events:

1. `ExchangeCollector` buffers incoming user transcript messages (`role: "user"`). If Flux emits multiple segments before a reply, they are joined with spaces.
2. When the assistant message arrives (`role: "assistant"`), `ExchangeCollector.add` pairs the buffered user text with the assistant reply and extracts TTFT from metrics (`llmNodeTtft`).
3. To maintain strict turn ordering without races, saves are chained serially on a promise chain (`saving = saving.then(() => save(exchange))`).
4. If `sessionId` is `null`, the session is created on demand in Postgres (`startSession`) when the first turn is saved. Voice sessions that terminate without any spoken turns leave no database rows.
5. Turns are saved via `saveExchange(db, { sessionId, userText, inputMode: "voice", replyText, replyTurnId, firstTokenMs })`.
6. For assistant messages, latency metrics (`endOfTurnDelay`, `llmNodeTtft`, `ttsNodeTtfb`, `e2eLatency`) are logged to stdout prefixed with `[voice]`.
7. `ctx.addShutdownCallback` flushes any remaining buffered user turn and awaits all in-flight database saves before disconnecting.

### Quota

1. **What counts:** Connected wall-clock time from when the agent connects until the job shuts down. It counts elapsed wall-clock time rather than speech duration because vendors bill the entire active stream (Flux streams continuously and LiveKit bills session minutes), and learners perceive daily quota as session time ("5 minutes a day").
2. **Worker start checks:** Before joining the room, `loadVoiceContext` performs the worker's own validation of consent (`profile.voiceConsentAt !== null`) and remaining quota (`remainingVoiceSeconds > 0`). This guards against dispatches that execute after token issuance when quota has already expired.
3. **Session metering loop:** The session is metered into `voice_usage` periodically via `startVoiceMeter`. It ticks every 15 seconds (`METER_INTERVAL_MS = 15_000`), or sooner when fewer seconds remain (`nextMeterDelayMs`, down to a 1 s floor) so that the cut-off lands right on time.
4. **Attributes to the browser:** On connect and every meter tick, the worker announces remaining time to the room via participant attribute `fluency.remaining_seconds`. When a session is terminated by the worker, it announces `fluency.end_reason` (`"quota"` or `"consent"`).
5. **Quota cut-off:** When remaining seconds reach 0, the worker lets the current reply finish, speaks a brief goodbye (`QUOTA_GOODBYE`, uninterruptible), then deletes the room (`ctx.deleteRoom()`). That disconnects the learner too, so their microphone stops streaming.
6. **Withdrawn consent:** If the learner withdraws live voice consent in Settings mid-session, the worker ends the session immediately without speaking a goodbye.
7. **Final write on shutdown:** On job shutdown, `meter.stop()` flushes and records any leftover elapsed seconds into `voice_usage` before persisting the remaining exchange collector state.

### Latency

Latency from the end of the learner's speech to the first audible reply audio is measured in the browser (`hooks/useLiveVoice.ts`, via `createLatencyTracker` in `lib/live-voice.ts`) using Web Audio `AnalyserNode`s every 10 ms. Learner speech is detected when the microphone level exceeds -45 dBFS (`MIC_SPEECH_DBFS`), and reply audio is detected when agent audio exceeds -50 dBFS (`AGENT_AUDIO_DBFS`) after the agent enters `thinking` or `speaking` (a reply prepared during the learner's turn can skip `thinking`). Once the worker has set `fluency.end_reason`, the next audio is the quota goodbye and isn't timed.

The browser number is larger than the worker's `[voice] … e2e` log line: it adds the network, the browser's playout buffer and the time before the server's end-of-turn detection starts. In the 2026-10-26 headless Chrome test from Dhaka it was 600–900 ms above `e2e`.

A hidden or throttled browser tab (tick gap > 100 ms) or an audio onset with a noisy microphone/overlap (< 100 ms) skips timing for that turn rather than reporting a misleading number. When the reply is saved, the worker announces its ID via the `fluency.reply_turn_id` participant attribute; the browser then saves the pending measurement to `session_turns.speech_end_to_audio_ms` via a server action.

Running `pnpm voice:latency [--since YYYY-MM-DD] [--learner <uuid>]` reports p50 and p90 against the exit gate (p50 < 750 ms, p90 < 950 ms). At least 20 turns are required before issuing a pass/fail verdict.

### Pronunciation

Each learner turn gets a scripted Azure pronunciation assessment, with its Flux transcript as the reference text, after the exchange is saved (doc/voice-path.md, Decision 4).

1. **The audio copy:** `ScoringAgent` overrides `sttNode` and `tee()`s the learner's audio. Flux gets one branch exactly as before, and the other is resampled from 24 kHz to 16 kHz mono into a `TurnAudioBuffer` that holds at most 60 s.
2. **Cutting the turn:** Each learner message's speaking times (`startedSpeakingAt`, `stoppedSpeakingAt`) cut its audio out of the buffer, from 1 s before to 0.3 s after, since Flux reports the start of speech a little late.
3. **What's scored:** Turns under 3 words or 1 s are skipped ("Yes.", "Okay").
4. **Never blocking a reply:** Scoring runs one turn at a time on its own promise chain (`scoring`), which nothing on the reply path waits for. An error is logged and that turn is skipped, with no retry.
5. **What's saved:** One `pronunciation_scores` row per scored turn: the overall accuracy, fluency, prosody, completeness and pronunciation scores, the weak words (< 60) and the phoneme mismatches. No audio and no transcript is stored or logged.
6. **Off without Azure:** Without `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`, the worker logs one line and runs as before, with no audio copy.
7. **Azure F0 limit:** The free tier allows 1 concurrent recognition, so two learners scored at the same moment can make one fail; that turn is skipped.
8. **At shutdown:** The worker waits up to 15 s (`SCORING_DRAIN_MS`) for scoring still in flight.

In a 2026-10-26 test, 12 s of accented reading was scored in 5.2 s.

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

- **No recording:** `session.start` passes `record: false`. By default, LiveKit Agents writes the session audio to `audio.ogg` in the OS temp folder and uploads audio, transcript and traces to LiveKit Cloud. Fluency stores no raw audio: the copy for Azure scoring is kept in memory only until its turn is scored.
- **No greeting:** In alignment with text conversation mode, the tutor does not greet first; the learner speaks first.
- **English-only STT:** Deepgram Flux general English is used. Spoken Bangla words in A1/A2 turns may be dropped or turned into English-sounding guesses. FLU-68 tests this against `deepgram/flux-general-multi`.
- **Enforcement hooks:** Quota limits and consent checks are verified when requesting a token (`POST /api/voice/token`). The running session is metered and cut off by the worker. A learner can go past the 300 s by the rest of the current reply plus the goodbye (8 s in testing: 308 s).
- **Finish delay shortcut:** The 1.5 s wait before finishing a live session is a temporary shortcut to give the worker time to persist the final exchange before recap generation.
- **Database connectivity & deployment:** The worker requires direct Postgres database access. As a result, it cannot be deployed to LiveKit Cloud until a managed Postgres database reachable from the cloud worker is configured (FLU-67).
