# Voice path decision record (FLU-58)

Status: **decided (user, 2026-10-26).** Claude drafted it the same day from the FLU-54, FLU-56 and FLU-57 measurements, and the user confirmed every recommendation.

## What it is

Phase 4 replaces Web Speech with a live voice loop. Its exit gate is **p50 < 750 ms and p90 < 950 ms** from the end of the learner's speech to the first reply audio, measured in the browser. This record picks the four parts of that loop: the voice path, the live model, the TTS vendor and the pronunciation mode. Tasks 09–16 (FLU-59 to FLU-66) are specified against it.

## Summary

| Part          | Recommendation                                                                                 | Fallback                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Voice path    | LiveKit Agents worker (Node), hosted on LiveKit Cloud, Deepgram Flux through LiveKit Inference | AssemblyAI or Cartesia Ink for STT; Gemini Live if the pipeline can't meet the gate |
| Live model    | Gemma 4 31B through LiveKit Inference (TTFT p50 426 ms)                                        | GPT-4.1 mini through LiveKit Inference                                              |
| TTS           | Cartesia Sonic-3 through LiveKit Inference, because it can speak the Bangla help               | Cartesia direct; Gradium if Bangla stays off the audio                              |
| Pronunciation | Azure scripted assessment on the Flux transcript, per turn, off the critical path              | —                                                                                   |

Fixed before this record (2026-10-25): no Deepgram account, so Deepgram models run through LiveKit Inference; no direct Anthropic key, so Claude runs only through OpenCode.

## Where the numbers come from

```
scripts/voice/ttft.ts        # pnpm voice:ttft — live-model time to first token (FLU-54, extended here)
scripts/voice/tts-ab.ts      # pnpm voice:tts-ab — TTS time to first audible sample (FLU-56)
scripts/voice/azure-pron.ts  # pnpm voice:azure — Azure pronunciation assessment (FLU-57)
```

All three ran **from Dhaka, on the user's home connection.** In production the worker runs in a data centre. Every vendor call starts from there, so each one saves the Dhaka-to-vendor round trip, which is often 200–300 ms to the US. Only the browser-to-LiveKit leg stays as slow as Dhaka. The numbers below rank the vendors fairly, but they overstate each stage's absolute latency.

## The latency budget

From the moment the learner stops speaking, these happen in order:

| Stage                                                              | Estimate                                | Source                                              |
| ------------------------------------------------------------------ | --------------------------------------- | --------------------------------------------------- |
| Learner audio reaches the worker (browser → LiveKit edge → worker) | 50–100 ms                               | not measured; WebRTC from Dhaka to the nearest edge |
| Flux decides the turn has ended                                    | ~260 ms                                 | Deepgram's figure for `EndOfTurn`                   |
| Live model's first token                                           | ~430–530 ms (Gemma 4 31B, p50–p90)      | `pnpm voice:ttft`, from Dhaka                       |
| TTS first audible sample                                           | ~370 ms (Cartesia through LiveKit, p50) | `pnpm voice:tts-ab`, from Dhaka                     |
| Reply audio reaches the browser                                    | 50–100 ms                               | not measured                                        |

Done one after another with the recommended parts, the p50 is about 75 + 260 + 430 + 370 + 75 ≈ **1,210 ms**. The 750 ms p50 can only be met if part of the work overlaps and the vendor legs get shorter:

- **Preemptive generation.** With Flux's `eager_eot_threshold` set, Flux sends `EagerEndOfTurn` before it is sure the turn is over. The worker's `AgentSession` (`turnHandling.preemptiveGeneration`) then starts the model and TTS on the draft transcript, and drops that draft if the learner keeps talking (`TurnResumed`). Deepgram says this saves "hundreds of milliseconds", at the cost of 50–70% more model calls.
- **Worker placement.** Run the worker next to the vendors, not in Dhaka. The model and TTS times above then lose most of their round trip.

If preemptive generation hides most of Flux's 260 ms, and the data centre saves 100–200 ms on each of the model and TTS calls, the p50 comes to roughly 550–750 ms. That's an estimate from Dhaka numbers, and the gate is tight. FLU-63 measures the real end-to-end number. This record picks the parts most likely to fit and keeps each one swappable.

## Decision 1: voice path

**Recommendation: a LiveKit Agents worker in Node (`@livekit/agents`), hosted on LiveKit Cloud, with Deepgram Flux STT through LiveKit Inference.** This was the provisional choice in the Phase 4 plan, and nothing measured since changes it.

- The pipeline stays in our code: our `lib/prompts.ts` prompt, the model choice, turn saving, and the quota and consent checks. The worker can also send a copy of learner audio to Azure for pronunciation scoring.
- Flux model: `inference.STT({ model: "deepgram/flux-general-en" })`, with `eager_eot_threshold` set to enable preemptive generation.
- **Hosting on LiveKit Cloud** puts the worker on the same network as the Inference gateway. The Build plan includes 1 agent deployment, 1,000 agent session minutes, 5 concurrent sessions and $2.50 of Inference credit (about 50 minutes) a month. That covers development and the exit check. Real learners need the Ship plan (from $50/month). Region pinning is on the Scale plan only.
- **Flux is English-only** (`flux-general-en`). The A1–A2 rules say learners may mix in Bangla. Spoken Bangla words will be dropped or come back as English-sounding guesses. The live partner then answers a garbled transcript, and the Bangla can't be scored. Not tested yet; FLU-59 should try a mixed sentence. If the transcript is unusable, the voice UI can tell A1–A2 learners to type a Bangla question instead.
- STT fallbacks if Flux doesn't fit: AssemblyAI Universal-Streaming (needs a new account) or Cartesia Ink (existing key).
- **Not chosen:** a speech-to-speech model such as Gemini Live (`gemini-3.1-flash-live-preview` is on the user's Google key). It would skip the separate STT and TTS stages, but it gives no Flux transcript for scripted pronunciation scoring, it locks the voice to Google's, and Gemini calls on this Google key timed out or returned 503 in both benchmarks. It stays the fallback if FLU-63 shows the pipeline can't meet the gate.

**Decided:** the LiveKit Agents worker, hosted on LiveKit Cloud.

## Decision 2: live model

`pnpm voice:ttft`, 2026-10-26, from Dhaka. Every run uses the same A2 café prompt and 10 short learner turns. LiveKit rows are 20 runs; the others are 10:

| Model                              | Route             | TTFT p50      | TTFT p90   | Total p50 | $/1M in / out |
| ---------------------------------- | ----------------- | ------------- | ---------- | --------- | ------------- |
| **Gemma 4 31B**                    | LiveKit Inference | **426 ms**    | **532 ms** | 671 ms    | 0.40 / 1.20   |
| GPT-4.1 mini                       | LiveKit Inference | 836 ms        | 867 ms     | 1085 ms   | 0.40 / 1.60   |
| Claude Haiku 5.5                   | OpenCode          | 857 ms        | 1035 ms    | 1139 ms   |               |
| GPT-5.4 mini                       | LiveKit Inference | 893 ms        | 1002 ms    | 1095 ms   | 0.75 / 4.50   |
| GPT-5.4 mini, low reasoning effort | LiveKit Inference | 901 ms        | 1060 ms    | 1125 ms   | 0.75 / 4.50   |
| Claude Sonnet 5.5                  | OpenCode          | 1013 ms       | 1177 ms    | 1373 ms   |               |
| Gemini 3.5 Flash Lite              | LiveKit Inference | 1105 ms       | 1279 ms    | 1182 ms   | 0.30 / 2.50   |
| Gemini 3.8 Flash                   | LiveKit Inference | 2023 ms       | 3433 ms    | 2354 ms   | 0.75 / 3.75   |
| Gemini 3.8 Flash                   | Google, direct    | all 10 failed |            |           |               |

- **Gemma 4 31B is about twice as fast as everything else**, and the cheapest. LiveKit hosts it itself and calls it its recommended default for voice agents. An earlier 10-run sample gave p50 427 ms and p90 925 ms. The 20-run p90 of 532 ms is the better estimate, but FLU-63 should confirm it.
- Claude through OpenCode is faster today than on 2026-10-22 (Haiku p50 857 ms, then 1147 ms), but it's still twice Gemma's time. The OpenCode hop can't be removed without a direct Anthropic key.
- Gemini 3.8 Flash is slow and erratic on both routes. On the direct route, every call timed out after 30 s or returned 503, as it did in FLU-54. It also spends about 190 thinking tokens on a one-line reply, and `thinkingLevel: "minimal"` isn't supported for it.
- GPT-5.4 mini at low reasoning effort is no faster than its default.

**Reply quality, 5 turns on the same prompt (Gemma 4 31B and GPT-4.1 mini):** both stayed under 45 words (15–31), asked one follow-up each time, and taught "Can I have the bill, please?" when asked. When the learner wrote "Yesterday I go… we eat many pastry", Gemma recast it naturally ("you visited us yesterday… enjoyed the pastries") without correcting them. When asked what "to go" means, Gemma answered in Bangla, as the A2 rules say; GPT-4.1 mini answered in English. Five turns is a smoke test, not an eval.

**Recommendation: Gemma 4 31B through LiveKit Inference (`inference.LLM({ model: "google/gemma-4-31b-it" })`) for voice turns, with GPT-4.1 mini as the fallback.**

- The model is only a model id in the worker, so switching to the fallback is a one-line change.
- The text and Web Speech path keeps Claude Sonnet 5.5 through OpenCode. Only voice turns use Gemma.
- Gemma uses the same `lib/prompts.ts` prompt as Claude. Before FLU-59 ships, run a wider quality pass on all 4 scenarios and the 3 levels.

**Decided:** Gemma 4 31B for voice turns. Voice and text replies come from different models.

## Decision 3: TTS vendor

`pnpm voice:tts-ab`, 8 runs per voice, from Dhaka. _Heard_ means the first audible sample, so it includes any leading silence:

| Voice                      | Route             | Heard p50 | Heard p90 | $/1M chars |
| -------------------------- | ----------------- | --------- | --------- | ---------- |
| Gradium Everly (f)         | direct            | 299 ms    | 337 ms    | 47.8       |
| Gradium Garrett (m)        | direct            | 301 ms    | 319 ms    | 47.8       |
| Cartesia Sonic-3 Katie (f) | LiveKit Inference | 369 ms    | 644 ms    | 50         |
| Cartesia Sonic-3 Katie (f) | direct            | 510 ms    | 660 ms    | 39.2       |
| Cartesia Sonic-3 Blake (m) | direct            | 538 ms    | 990 ms    | 39.2       |
| Gradium Everly (f)         | LiveKit Inference | 722 ms    | 809 ms    | 48         |
| Deepgram Aura-2 Athena (f) | LiveKit Inference | 1057 ms   | 1272 ms   | 30         |
| Deepgram Aura-2 Apollo (m) | LiveKit Inference | 1271 ms   | 1992 ms   | 30         |

- Cartesia's first byte arrives first, but it starts with about 300 ms of silence, so Gradium is heard sooner.
- Aura-2 alone is over the whole 750 ms budget. It's out.
- **Gradium direct** is fastest and steadiest (p90 within 40 ms of p50). But the Node worker would need a custom TTS class around Gradium's WebSocket: LiveKit's Gradium plugin is Python-only, and Gradium through LiveKit Inference is 400 ms slower.
- **Cartesia through LiveKit Inference** is about 70 ms slower at p50, with a wider p90. It needs no custom code (`inference.TTS({ model: "cartesia/sonic-3" })`) and runs on the same network as the worker.

**Bangla in replies decides it.** The A1–A2 rules tell the partner to help briefly in Bangla, and Gemma does. The TTS has to say those words:

- **Cartesia Sonic-3 supports Bangla** (`bn`, one of its 42 languages).
- **Gradium supports only English, French, German, Spanish and Portuguese.** With Gradium, Bangla help could only be shown on screen, with the Bangla part skipped in the audio.

Claude synthesized Gemma's mixed reply ("To go মানে হলো খাবারটি সাথে করে নিয়ে যাওয়া। You take the food away from the café.") with Cartesia's Katie voice in both modes: `out/tts-ab/bangla/katie-bn.wav` (`language: "bn"`) and `out/tts-ab/bangla/katie-en.wav` (`language: "en"`).

**The user listened (2026-10-26): `katie-en` says both the Bangla and the English better than `katie-bn`.** So mixed replies go to Cartesia as one request with `language: "en"`. The worker doesn't split them by script.

**Recommendation: Cartesia Sonic-3 through LiveKit Inference, with `language: "en"`.** Cartesia direct (with our own key) is the fallback, with the leading silence trimmed. Gradium stays an option only if Bangla is kept off the audio. The voice choice in FLU-62 (by CEFR level) uses Cartesia's voices.

**Decided:** Cartesia Sonic-3 through LiveKit Inference, with spoken Bangla help. The voice is Katie. The user rates the other voices in FLU-62, when voices are chosen per level.

## Decision 4: pronunciation mode

From FLU-57, on the user's 3 recordings:

- **Use scripted assessment on the Flux transcript, not unscripted.** Unscripted mode misheard words (drank → drink, project → magic, Mirpur → Millport) and then marked its own wrong words as mispronounced. Scripted mode on the true transcript reported no weak words in free talk or natural reading.
- Proper nouns and words outside Azure's lexicon (Mirpur scored 38 even from a TTS voice) need a filter before they're reported.
- Detecting a pattern needs phoneme-level data: a low phoneme score _and_ an NBest top guess that differs from the expected sound. A word `AccuracyScore` below 60 catches only gross errors.
- Add `w>b` → `IPA:/w/_to_[v]` and `s>i` → `IPA:/sC/_to_[isC]` to `AZURE_TO_CATALOG` (task 15).
- The recap must not say "no errors" for /θ/, /z/→[dʒ], /f/ or /ð/. Azure barely flags them.
- Azure's result lags the speech by 1.1–1.6 s at p50 and up to 2.6 s. That's fine for background scoring that never blocks a turn (FLU-64).
- The Azure F0 tier allows 1 concurrent recognition, so the scoring job runs one learner at a time until the tier is upgraded.

**Recommendation: scripted mode on the Flux transcript, scored per turn in the background.** Scripted mode needs the reference text before recognition starts. So the worker keeps each learner turn's audio in memory until Flux's final transcript arrives, then sends both to Azure off the turn's critical path. The audio buffer is dropped once it's scored. No audio is stored, as decided for Phase 4.

**Decided:** scripted mode.

## Notes

- Gradium direct was measured from Dhaka. LiveKit Cloud chooses the worker's region (no pinning on Build), and Gradium's servers may be far from that region. If so, Cartesia through LiveKit Inference, which runs on the same network as the worker, may win there.
- Re-run the benchmarks from the deployed worker in FLU-59, before FLU-63 measures the real loop. Those numbers replace the Dhaka ones here.
- The one-speaker caveat from FLU-57 holds. Re-check pronunciation thresholds on real learner audio, with consent.
