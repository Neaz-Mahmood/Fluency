# API

The browser talks to a single streaming endpoint, `POST /api/chat`, which validates the request, picks an AI provider, and pipes the response back as plain text.

## What it is

A Next.js Route Handler that accepts the learner's new message and streams the partner's reply as `text/plain; charset=utf-8`. The handler is server-only — the API keys never reach the browser.

## Where it lives

```
app/api/chat/route.ts   # POST handler
lib/chat-request.ts     # parseChatRequest (validation)
lib/provider.ts         # resolveProvider (env-var logic)
lib/provider-errors.ts  # ProviderError, toProviderError, providerErrorResponse
lib/reply-stream.ts     # startReply (first-token wait and idle timeout)
lib/learner.ts          # getLearner (anonymous learner from the cookie)
lib/sessions.ts         # findOpenSession, startSession, loadTurns, saveExchange
lib/prompts.ts          # getSystemPrompt (per-scenario behavior)
```

## Request shape

```
POST /api/chat
Content-Type: application/json

{
  "scenarioId": "free-chat" | "job-interview" | "cafe" | "neighbor",
  "sessionId": "uuid",          // optional: from the previous reply's X-Session-Id
  "inputMode": "voice" | "typed", // optional: how the message was produced
  "message": "string"           // the learner's new turn
}
```

## Response

Before streaming starts, a provider failure returns a JSON error response:

- `503` busy: "The AI partner is busy right now. Try again in a moment."
- `504` timeout: "The AI partner took too long to answer. Try again."
- `502` failed: "The AI partner could not reply. Try again."

Once streaming begins, the handler returns a `ReadableStream<Uint8Array>` with:

- `Content-Type: text/plain; charset=utf-8`
- `Cache-Control: no-store`
- `X-Session-Id: <uuid>`: the saved session this turn belongs to. The client sends it back as `sessionId` on the next turn.

The body is the raw text of the partner's reply, streamed token-by-token. If the client cancels the request, the handler calls `reply.abort()` so the upstream provider stops generating.

## Validation (`lib/chat-request.ts`)

`parseChatRequest(body)` enforces:

- Body is a JSON object.
- `scenarioId` is one of the four supported ids (`isScenarioId`).
- `message` is a non-empty string of at most `MAX_CHARS = 2000` characters after trimming.
- Any other field (such as an old-style `messages` array) is ignored.

The history sent to the provider is `buildHistory(savedTurns, message)`: the session's saved turns plus the new message, with consecutive turns from the same speaker joined so roles alternate. More than `MAX_TURNS = 40` turns returns `400` "This conversation is too long. Start a new one."

Validation errors return `400` with `{ "error": "<message>" }`. Malformed JSON also returns `400`.

## Provider resolution (`lib/provider.ts`)

The handler calls `resolveProvider()` (see [ai-providers.md](./ai-providers.md)) before streaming. If provider resolution fails (for example, no API key is set), the handler returns `503` with the error message.

## Learner and session

Before streaming, the handler loads the current learner with `getLearner()` (`lib/learner.ts`), which reads the `fluency_learner` cookie set by `proxy.ts`. If the request has a `sessionId`, `findOpenSession()` (`lib/sessions.ts`) returns it only if it belongs to this learner, is for the same scenario and hasn't ended, and `loadTurns()` reads its history. Otherwise the turn starts a new conversation, so a client can't read or write another learner's session. A new session is created with `startSession()` only after the first token arrives, so a failed first turn creates no session. If the database is unreachable, the handler returns `503`.

## Saving turns

A failure before the first token saves nothing. When a reply starts, the stream resolves a promise with the streamed text when the reply ends, whether it completes, fails or is cancelled. An `after()` callback (`next/server`) waits for it and calls `saveExchange()`. That appends the latest user message (with `inputMode`) and the reply to `session_turns` in one transaction that locks the session row. An empty reply saves only the user turn. Saving never delays the reply, and a save failure is logged, not shown to the learner.

## Streaming

After provider resolution, the handler dispatches to `streamClaudeReply` or `streamGoogleReply`. The reply's async iterator is wrapped in a `ReadableStream`. Each chunk is encoded as UTF-8 and pushed to the controller. The `cancel()` callback on the stream aborts the underlying provider call, so closing the connection stops the generation immediately.

## Time limits

The route waits up to 20 s for the first token (`FIRST_TOKEN_TIMEOUT_MS` in `lib/reply-stream.ts`). After that, 15 s without a chunk (`IDLE_TIMEOUT_MS`) aborts the provider and ends the stream, keeping the partial reply.

## Notes

- There is no separate non-streaming endpoint. The client always streams.
- There is no login yet (Phase 5). The learner is identified by the anonymous `fluency_learner` cookie.
- The route waits for the first token, so errors before it are returned as JSON.
- The route is the only network surface between the browser and the AI providers.
