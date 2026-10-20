# Conversation

The conversation screen hosts the practice session: it owns the turn history, the status state machine, the auto-scrolling transcript, and the stop/interrupt button.

## What it is

A single React component (`<Conversation />`) that wires together the scenario picker, the mic/text input, the streaming API call, and the spoken reply. It is the only client component on the practice route.

## Where it lives

```
components/Conversation.tsx  # Conversation lifecycle, status, transcript
components/Transcript.tsx     # Render-only transcript list with empty state
app/practice/page.tsx         # Route that hosts <Conversation />
```

## Status state machine

`<Conversation />` exposes a `Status` enum with four values:

| Status | When | What the user sees |
| --- | --- | --- |
| `idle` | Default; between turns | "Ready for input" or "Hands-free active" |
| `listening` | Mic session is open | "Listening…" |
| `thinking` | Request is in flight | "Processing…" |
| `speaking` | TTS is playing the partner's reply | "Speaking…" |

The state is mirrored to `statusRef` so the recognition and fetch callbacks can read it without re-binding.

## Turn lifecycle

1. The user picks a scenario in `<ScenarioPicker />`, which resets the transcript and stores the id.
2. The user speaks (mic path) or types (text path). Both end up calling `sendUserText(text)`.
3. `sendUserText` trims the text, aborts any in-flight request, stops any in-flight TTS, and increments `turnToken` to invalidate stale replies.
4. The user turn is appended to the `turns` array, an empty assistant turn is appended, and `setStatus("thinking")` runs.
5. The component streams `POST /api/chat`. As chunks arrive, the assistant turn is updated in place. On error or empty reply, the turn is removed and the error is surfaced.
6. On a non-empty final reply, `speakReply(text, token)` speaks the reply and returns to `idle`. With hands-free on, listening restarts automatically.
7. The "Stop" button calls `interrupt()`, which increments the turn token, aborts the request, aborts recognition, cancels TTS, and drops any empty turns.

## Turn-token guard

A monotonic `turnToken` ref ensures that responses from a previous turn cannot overwrite the current one. Every status-setting callback that comes from a request or TTS session checks `isCurrent(token)` before mutating state. Calling `interrupt()` (or starting a new turn) advances the token and silently invalidates any pending work.

## Transcript

- The transcript is rendered by `<Transcript />` inside a scrollable container.
- An `aria-live="polite"` region announces new turns.
- A `useEffect` watches `turns`, `interim`, and `status` to keep the container scrolled to the bottom.
- When the transcript is empty, `<Transcript />` shows a "Ready to listen" empty state with instructions.

## Notes

- All side effects (recognition, TTS, fetch) are torn down on unmount via the `useEffect` cleanup.
- The header shows the active scenario and a "Switch scenario" button that interrupts the current session and returns to the picker.
- The Stop button is only shown when the conversation is `listening`, `thinking`, or `speaking`.
