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

While the room connects, the worker sends the model the session's prompt once and stops at the first chunk (`warmPromptCache` in `worker/llm-warmup.ts`), so the learner's first turn finds it in the model server's prompt cache (FLU-75). It logs `[voice] prompt cache warm-up: N ms`.

Turn handling enables preemptive generation (`turnHandling: { preemptiveGeneration: { enabled: true, preemptiveTts: true } }`), drafting model replies on eager end-of-turn signals to cut latency. `preemptiveTts` (FLU-73) starts Katie's audio on the draft too. Without it, TTS waited for the end of turn even when the draft's first token was ready, which cost 250–330 ms on those turns. Each reply's leading near-silent frames (below -60 dBFS, at most 300 ms) are dropped before they're sent (`trimLeadingSilence` in `worker/tts-audio.ts`), so the learner hears the first word up to 150 ms sooner. The browser measurement (see Latency) is the number the gate uses: p50 < 1.6 s and p90 < 2.2 s, reset from 750 / 950 ms on 2026-10-27 (`doc/voice-path.md`, Decision 2).

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

**Measured on the deployed worker (2026-10-27).** Headless Chrome ran in Dhaka on a home connection. A fake microphone played `out/flu63/fake-mic.wav` (9 turns), once for each of three test learners. The worker ran on LiveKit Cloud `ap-south`, and the app ran locally against Supabase.

| Measure                                      | p50     | p90     |
| -------------------------------------------- | ------- | ------- |
| Browser: speech end → first audio (27 turns) | 1789 ms | 2250 ms |
| Worker `e2e`                                 | 1082 ms | 1336 ms |
| Worker `endOfTurn`                           | 384 ms  | 989 ms  |
| Worker `llmTtft` (Gemma 4 31B)               | 367 ms  | 922 ms  |
| Worker `ttsTtfb` (Cartesia)                  | 143 ms  | 154 ms  |

The gate at the time (p50 < 750 ms, p90 < 950 ms) fails. The worker's own `e2e` is already above 750 ms at p50. The browser adds a further ~700 ms at p50 for the network, the playout buffer, and the gap between the last audible sound and the start of Flux's end-of-turn timing. When the worker ran on a Mac in Dhaka (2026-10-26, 14 turns), it was p50 1859 ms and p90 2538 ms.

A hidden or throttled browser tab (tick gap > 100 ms) or an audio onset with a noisy microphone/overlap (< 100 ms) skips timing for that turn rather than reporting a misleading number. When the reply is saved, the worker announces its ID via the `fluency.reply_turn_id` participant attribute; the browser then saves the pending measurement to `session_turns.speech_end_to_audio_ms` via a server action.

Running `pnpm voice:latency [--since YYYY-MM-DD] [--learner <uuid>]` reports p50 and p90 against the exit gate (p50 < 1.6 s, p90 < 2.2 s). At least 20 turns are required before issuing a pass/fail verdict.

#### The bench and the per-turn timeline (FLU-72)

`pnpm voice:bench [--url http://localhost:3000] [--learners 1-5] [--wav <file>]` reproduces the measurement. It needs Chrome and a WAV of learner turns. The default `out/flu63/fake-mic.wav` (9 turns, 172 s) is local only, since `out/` is gitignored.

For each learner, headless Chrome plays the WAV as the microphone in a café live voice session, and the browser saves its numbers as usual. The script then prints the gate report for that run, plus the browser's network round trip and jitter buffer. The learners have `user_id` `voice-bench-1` to `voice-bench-5`, and today's voice usage is cleared for those learners only, so runs aren't refused by the quota.

The app at `--url`, the script and the worker must all use the same database, because the browser's numbers are saved on the worker's turns. Against the deployed worker:

```bash
node --env-file=.env.supabase -e "require('child_process').spawnSync('pnpm',['dev','--port','3100'],{stdio:'inherit'})"   # terminal 1
node --env-file=.env.supabase -e "require('child_process').spawnSync('pnpm',['voice:bench','--url','http://localhost:3100'],{stdio:'inherit'})"   # terminal 2
lk agent logs | grep "timeline:"   # the worker's side
```

Each run uses real LiveKit Inference minutes: about 3 minutes per learner. The Build plan includes about 50 minutes a month.

Both sides log one line per reply. The browser line is `[voice] speech end → first audio: N ms (speech end at <epoch ms>, audible at <epoch ms>)`, followed by `[voice] network: rtt …, jitter buffer …, edge …` from the agent track's WebRTC stats (`readAudioStats` and `audioStatsLine` in `lib/live-voice.ts`). The worker logs, in milliseconds after LiveKit's `stoppedSpeakingAt`:

```
[voice] timeline: last word -22, eot +383, transcript delay 119 | llm +92 (preemptive, lead 291) first token +989 | tts +990 first text +1006 first audio +1330 audible +1410 | speaking +1331 | llm calls 1, tts calls 1 | t0 <epoch ms>
```

- **`TimedAgent`** (`worker/timeline.ts`) times every LLM and TTS node call. It also reads the end of the last word from Flux's word timings.
- **The reply's call** is the last one started before the agent spoke. It's `preemptive` when it started before the end of turn.
- **`audible`** is the first frame above the browser's -50 dBFS threshold (`AGENT_AUDIO_DBFS`).
- **`t0`** lines up with the browser's wall-clock times. This Mac's clock was within about 15 ms of NTP.

**Where the time goes (2026-10-27).** These are 54 turns over four runs against the deployed worker, from Dhaka. The worker stages are on the worker's clock:

| Stage (ms after the learner stopped speaking)                 | p50 | p90  |
| ------------------------------------------------------------- | --- | ---- |
| End of turn committed                                         | 384 | 1076 |
| Model call start → first token (Gemma 4 31B)                  | 376 | 907  |
| Waiting for the first token after end of turn                 | 338 | 684  |
| Voice: first text → first audio frame (Cartesia)              | 180 | 337  |
| Leading silence: first frame → first audible frame (27 turns) | 80  | 150  |
| **Worker total: first audio frame**                           | 996 | 1731 |

- **Preemptive generation is used on 36 of 54 turns.** The draft starts only about 250–400 ms before the end of turn, while the model's first token takes 376 ms at p50. So the reply still waits for the model on most turns. On the other 18 turns, Flux's early end-of-turn signal never came, and the call started at the end of turn (about +300 ms).
- **The end-of-turn tail is a pause, not slow finals** (corrected in FLU-73). On about 1 turn in 5, the learner paused mid-sentence. LiveKit's `stoppedSpeakingAt` lands on the pause, and the learner's last word comes 0.7–1.0 s later. Measured from the real last word, the end of turn took 60–100 ms on those turns. On normal turns it takes about 380 ms. The table's end-of-turn p90, and the stages measured from `stoppedSpeakingAt`, are inflated by those turns. The browser number isn't affected, because it times from the learner's real last sound.
- **`preemptiveTts` is off,** so TTS starts only when the turn is committed. That cost 250–330 ms on the turns where the first token was ready before the end of turn.

The run with wall-clock times (9 turns) splits the browser number into three legs. The clock offset of about ±15 ms moves time between the uplink and the downlink, but not the total.

| Leg                                                  | p50    | Range    |
| ---------------------------------------------------- | ------ | -------- |
| Uplink: browser speech end → last word at the worker | 197 ms | 115–206  |
| Worker: last word → first audible frame out          | 962 ms | 666–1835 |
| Downlink: audible frame out → audible in the browser | 477 ms | 209–716  |
| **Sum (browser measured p50 1641 ms)**               | 1636   |          |

The downlink looked like a surprise, but FLU-74 explained most of it. The worker's `audible` mark is when Cartesia _produced_ the first audible frame, not when it played. The leading silence before that frame (80–150 ms) still had to play out, so the 477 ms included it. FLU-73 trims that silence, and FLU-74 measured the downlink from the moment the worker hands the audio to LiveKit; see below. Flux's last word lands within ±90 ms of LiveKit's `stoppedSpeakingAt` on 8 of 9 turns, so the worker's start point is accurate except on turns with a mid-sentence pause.

**After FLU-73 (2026-10-27, 9 turns):** browser p50 1540 ms, p90 2690 ms. Leading silence went from 80 ms to about 0, and on turns with an early draft the audio was ready at the end of turn. Nine turns are too few to compare p50s with confidence. Lowering `eager_eot_threshold` to 0.4 didn't move drafts earlier (still about 280 ms before the end of turn), so it stays at 0.5.

**The floor with this pipeline.** From the end of the learner's last word, three parts don't depend on the model or the voice:

- the uplink, about 200 ms;
- Flux's end of turn, about 380 ms on a normal turn;
- the downlink, about 250–300 ms (FLU-74).

Even with the model and TTS fully hidden by preemptive generation, that's about 800 ms, and in practice the model and TTS are rarely fully hidden. So the original 750 ms p50 gate can't be met by tuning this pipeline from Dhaka.

**The browser leg (FLU-74, 2026-10-27).** The bench adds `LEVEL_PROBE` to the page: it polls the agent track's inbound-rtp `audioLevel` every 10 ms and logs when the decoded audio rises after a silence (`[voice] bench: agent level at <epoch ms>`). The downlink then splits into two parts, over 9 turns:

- **Worker hands audio to LiveKit → decoded in the browser:** p50 291 ms (191–419). That's about 30 ms of one-way network (RTT 60–70 ms), a 75–120 ms jitter buffer, and the SFU, Opus framing and decoding.
- **Decoded → the latency analyser hears it:** the analyser lags the decoded level by 10–100 ms. That's the Web Audio path (`MediaStreamAudioSourceNode` and the analyser), which the learner's `<audio>` element doesn't go through. So the browser number may overstate what's heard by up to that much. It's left as is: the gate is defined on this measurement.
- **Worker → audible end to end:** p50 248 ms (146–418).

Ruled out:

- **DTX on Katie's track** (LiveKit's default): publishing with `dtx: false` kept silent frames flowing between replies. The downlink didn't improve (p50 301 ms) and the jitter buffer grew (122 ms vs 74), so DTX stays on.
- **The 200 ms output queue in `room_io`:** the SDK pushes the first frame to the audio source as soon as TTS produces it, and LiveKit's "speaking" time is stamped there. The queue only holds audio that is ahead of playout.

The browser leg comes to about 450–500 ms in total: about 200 ms uplink and 250–300 ms downlink. Nearly all of it is ordinary WebRTC transport from Dhaka, and none of it can be cut much from the app.

**After FLU-73 and FLU-74 (27 turns, 2026-10-27):** browser p50 1761 ms, p90 2292 ms, against the FLU-63 baseline of 1789 / 2250. On individual turns the FLU-73 changes save tens to a few hundred milliseconds, but the model's first-token time (p50 392 ms, p90 960 ms) varies more than that. Most of that tail was a cold prompt cache on the first two turns of a session. The warm-up at session start now removes it (FLU-75, `doc/voice-path.md` Decision 2). Cartesia's first audible audio takes 262 / 409 ms. What remains is a product decision: a realistic gate, or the speech-to-speech fallback from `doc/voice-path.md`.

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

The recap turns these rows into a pronunciation section after the session (FLU-65, [feedback.md](./feedback.md)).

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

### Deploying to LiveKit Cloud (FLU-67)

The worker runs on LiveKit Cloud as agent `CA_mSn9FeBq5KuT` in region `ap-south` (Mumbai), which is the same AWS region as the Supabase database. `livekit.toml` holds the project and agent ID. The `Dockerfile` installs production dependencies only and runs `worker/main.ts start` with the same Node flags as `pnpm voice:worker`, without a build step. `.dockerignore` keeps `.env*` out of the build context.

`lk` reads `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from the environment, so no `lk cloud auth` is needed:

```bash
node --env-file=.env -e "require('child_process').spawnSync('lk',['agent','deploy'],{stdio:'inherit'})"
# or with the variables exported in the shell:
lk agent deploy          # build on LiveKit Cloud and roll out a new version
lk agent status
lk agent logs            # add --log-type=build for build logs
lk agent update-secrets --secrets-file <file>
```

The agent's secrets are `DATABASE_URL` (the Supabase pooler URL, kept locally in the gitignored `.env.supabase`), `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`. LiveKit Cloud injects the `LIVEKIT_*` variables itself.

Run migrations against Supabase with the URL from that file:

```bash
node --env-file=.env.supabase -e "require('child_process').execFileSync('pnpm',['db:migrate'],{stdio:'inherit'})"
```

`pnpm voice:call` reaches the deployed worker whenever no local `pnpm voice:worker dev` is registered under the same agent name. Its turns are saved to Supabase, so `--learner` must be a learner that exists there and has given voice consent. The test learner has `user_id` `flu67-smoke-test`.

## Notes

- **No recording:** `session.start` passes `record: false`. By default, LiveKit Agents writes the session audio to `audio.ogg` in the OS temp folder and uploads audio, transcript and traces to LiveKit Cloud. Fluency stores no raw audio: the copy for Azure scoring is kept in memory only until its turn is scored.
- **No greeting:** In alignment with text conversation mode, the tutor does not greet first; the learner speaks first.
- **English-only STT:** Deepgram Flux general English is used. Spoken Bangla words in A1/A2 turns may be dropped or turned into English-sounding guesses. FLU-68 tests this against `deepgram/flux-general-multi`.
- **Enforcement hooks:** Quota limits and consent checks are verified when requesting a token (`POST /api/voice/token`). The running session is metered and cut off by the worker. A learner can go past the 300 s by the rest of the current reply plus the goodbye (8 s in testing: 308 s).
- **Finish delay shortcut:** The 1.5 s wait before finishing a live session is a temporary shortcut to give the worker time to persist the final exchange before recap generation.
- **Database connectivity:** The deployed worker uses Supabase Postgres in Mumbai through the Session pooler (`aws-0-ap-south-1.pooler.supabase.com:5432`, user `postgres.<ref>`). The direct host `db.<ref>.supabase.co` has only an IPv6 address, so LiveKit Cloud can't reach it. Session mode keeps prepared statements working. The Data API is turned off: the app connects only as `postgres`, and RLS is off on every table.
