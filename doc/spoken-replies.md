# Spoken replies

When the partner's reply arrives, `<Conversation />` hands the text to the browser's speech synthesis API. Replies are spoken sentence-by-sentence so they can be interrupted quickly.

## What it is

A thin wrapper around `window.speechSynthesis` that chunks the text on sentence boundaries, plays them in order, and exposes a single cancellation handle. A safety timer caps how long any single reply can run.

## Where it lives

```
lib/tts.ts                  # speakText, stopSpeaking, isSpeechSynthesisSupported
components/Conversation.tsx # Wires speakReply() to the streaming assistant turn
```

## How it works

- `isSpeechSynthesisSupported()` checks for `speechSynthesis` on `window`.
- `speakText(text, { onStart, onEnd, onError })` returns a cancel function. It first calls `synthesis.cancel()` to clear any in-flight speech, then loads available voices.
- The text is split on `[^.!?]+[.!?]+` and a trailing remainder, trimmed, and emptied of zero-length pieces. Empty input calls `onEnd` immediately.
- For each chunk, a new `SpeechSynthesisUtterance` is created with `lang: "en-US"` and `rate: 0.96`. The first utterance's `onstart` fires `onStart()` once.
- After each utterance ends, the next one is queued via `speakNext()`. `onEnd()` fires when the last chunk finishes, after the safety timer is cleared.
- A safety timer is set to `min(20000, 2500 + text.length * 70)` ms. If the timer fires, the synthesis is cancelled and `onEnd()` is called. This guards against `onend` never firing in some browsers.
- Errors on a single chunk call `onError()` if not already cancelled.
- The returned cancel function marks the session as cancelled, clears the timer, and calls `synthesis.cancel()`.

## Cancellation paths

- `stopSpeaking()` (exported helper) calls `synthesis.cancel()` directly. `<Conversation />` calls it on unmount, on scenario change, and when starting a new turn.
- `interrupt()` in `<Conversation />` cancels the in-flight fetch, recognition, and TTS together.
- The `useEffect` cleanup on unmount also runs the same tear-down.

## How it ties into the conversation

- `speakReply(text, token)` runs after the streamed assistant turn is finalized. It is only effective if speech synthesis is supported; otherwise it returns to `idle` immediately.
- `onStart`, `onEnd`, and `onError` callbacks check `isCurrent(token)` before mutating status, so an interrupted reply cannot flip the status back to `speaking`.
- When `onEnd` fires for a current token, the status returns to `idle`. If `handsFree` is on, `beginListening(false)` is called to restart the mic loop.

## Notes

- Voice and rate are not user-configurable in this build. `lang` is hard-coded to `en-US`.
- Some browsers (notably older Safari builds) occasionally drop `onend`; the safety timer ensures the conversation does not get stuck in `speaking` in that case.
- The sentence-chunking strategy is intentionally simple. Replies from the partner are short by prompt design, so the cost of mid-sentence cancellation is small.
