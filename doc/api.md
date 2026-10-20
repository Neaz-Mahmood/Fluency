# API

The browser talks to a single streaming endpoint, `POST /api/chat`, which validates the request, picks an AI provider, and pipes the response back as plain text.

## What it is

A Next.js Route Handler that accepts a JSON conversation and streams the partner's reply as `text/plain; charset=utf-8`. The handler is server-only — the API keys never reach the browser.

## Where it lives

```
app/api/chat/route.ts   # POST handler
lib/chat-request.ts     # parseChatRequest (validation)
lib/provider.ts         # resolveProvider (env-var logic)
lib/prompts.ts          # getSystemPrompt (per-scenario behavior)
```

## Request shape

```
POST /api/chat
Content-Type: application/json

{
  "scenarioId": "free-chat" | "job-interview" | "cafe" | "neighbor",
  "messages": [
    { "role": "user" | "assistant", "content": "string" },
    ...
  ]
}
```

## Response

The handler returns a `ReadableStream<Uint8Array>` with:

- `Content-Type: text/plain; charset=utf-8`
- `Cache-Control: no-store`

The body is the raw text of the partner's reply, streamed token-by-token. If the client cancels the request, the handler calls `reply.abort()` so the upstream provider stops generating.

## Validation (`lib/chat-request.ts`)

`parseChatRequest(body)` enforces:

- Body is a JSON object.
- `scenarioId` is one of the four supported ids (`isScenarioId`).
- `messages` is a non-empty array.
- At most `MAX_TURNS = 40` messages.
- Each message has `role` in `{"user", "assistant"}` and a non-empty `content` string.
- Each message is at most `MAX_CHARS = 2000` characters after trimming.
- Messages must strictly alternate between `user` and `assistant`.
- The first and the last message must be `user` (so the partner always has a turn to respond to).

Validation errors return `400` with `{ "error": "<message>" }`. Malformed JSON also returns `400`.

## Provider resolution (`lib/provider.ts`)

The handler calls `resolveProvider()` (see [ai-providers.md](./ai-providers.md)) before streaming. If provider resolution fails (for example, no API key is set), the handler returns `503` with the error message.

## Streaming

After provider resolution, the handler dispatches to `streamClaudeReply` or `streamGoogleReply`. The reply's async iterator is wrapped in a `ReadableStream`. Each chunk is encoded as UTF-8 and pushed to the controller. The `cancel()` callback on the stream aborts the underlying provider call, so closing the connection stops the generation immediately.

## Notes

- There is no separate non-streaming endpoint. The client always streams.
- There is no authentication; the route is open by design (no accounts yet).
- The route is the only network surface between the browser and the AI providers.
