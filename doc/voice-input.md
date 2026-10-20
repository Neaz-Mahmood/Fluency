# Voice input

The mic button on the practice screen captures what you say in real time, transcribes it with the browser's Web Speech API, and hands the final transcript to the conversation loop.

## What it is

A hold-to-talk microphone with an optional hands-free mode. You can also tap to listen continuously, and the button changes behavior based on how long you hold it.

## Where it lives

```
lib/stt.ts                # startListening, isSpeechRecognitionSupported, error mapping
components/Conversation.tsx  # Mic button, hold detection, hands-free loop
```

## How it works

- `lib/stt.ts` looks for `SpeechRecognition` or `webkitSpeechRecognition` on `window`. If neither is present, `isSpeechRecognitionSupported()` returns `false` and the typed fallback is shown instead.
- `startListening({ continuous, onUpdate, onEnd, onError })` creates a recognition instance with `lang: "en-US"`, `continuous: <flag>`, and `interimResults: true`. It returns a `ListeningSession` with `stop()` (graceful end) and `abort()` (cancel without firing `onEnd`).
- The recognition result handler concatenates final transcripts and tracks the latest interim transcript, calling `onUpdate(combined, isFinal)` as the user speaks. When recognition ends naturally it calls `onEnd(finalText)`.
- Known error codes are mapped to friendly messages:

  | Error | Message |
  | --- | --- |
  | `not-allowed` | Microphone access is blocked. Allow the mic, or type instead. |
  | `service-not-allowed` | Speech recognition is unavailable in this browser. |
  | `network` | Speech recognition needs a network connection in this browser. |
  | `audio-capture` | No microphone was found. |

  `aborted` and `no-speech` are silently ignored.
- The mic button uses pointer events with capture. The relevant constants and gestures in `components/Conversation.tsx`:
  - `HOLD_THRESHOLD_MS = 280` — a press shorter than this is treated as a tap.
  - Pointer down while idle starts `beginListening(true)` (continuous).
  - Pointer up after holding for at least 280ms (or while already listening) calls `finishListening()`, which `stop()`s the session and lets `onEnd` send the transcript.
  - `onPointerCancel` also ends the session cleanly.
- The transcript is sent through `sendUserText(text)` in `<Conversation />`, which is shared with the typed-input flow.

## Hands-free mode

- A toggle chip in the control panel flips `handsFree`. While `handsFree` is on, `speakReply()` calls `beginListening(false)` after the AI's spoken reply ends, looping the conversation without button presses.
- `handsFreeRef` mirrors the state so callbacks can read the latest value without re-binding.
- Hands-free listening uses `continuous: false`, so each partner reply restarts a fresh recognition session.

## Notes

- Speech recognition works in Chrome and other Chromium-based browsers. Firefox and Safari generally expose `webkitSpeechRecognition` but may surface the `service-not-allowed` error.
- A safety timer in `<Conversation />` ensures the session is aborted when the component unmounts.
- If recognition throws on `start()` (e.g. it is already running), `onError` reports "Speech recognition is already running" and the UI returns to idle.
