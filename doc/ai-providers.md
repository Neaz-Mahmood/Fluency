# AI providers

The chat route can stream from either Anthropic Claude or Google Gemini. The choice is made at request time based on environment variables, with an optional explicit override.

## What it is

A single selection function picks a provider and its key, then dispatches to a streaming function that exposes a uniform `AsyncIterable<string>` interface. Both providers are server-only and share the same call shape.

## Where it lives

```
lib/provider.ts        # resolveProvider (env-var logic)
lib/anthropic.ts       # streamClaudeReply (Claude via @anthropic-ai/sdk)
lib/google.ts          # streamGoogleReply (Google via fetch + manual SSE)
lib/prompts.ts         # getSystemPrompt (system prompt per scenario)
```

## Provider resolution (`lib/provider.ts`)

`resolveProvider(env = process.env)` returns either `{ provider, apiKey }` or `{ error }`.

The decision tree, in order:

1. Read `AI_PROVIDER` (trimmed and lowercased).
   - If it is set to something other than `claude` or `google`, return an error.
   - If it is `claude` and `CLAUDE_API_KEY` (or `ANTHROPIC_API_KEY`) is unset, return an error.
   - If it is `google` and `GOOGLE_API_KEY` (or `GEMINI_API_KEY`) is unset, return an error.
   - Otherwise, use the requested provider.
2. With no `AI_PROVIDER` set:
   - If both keys are set, return an error asking the user to disambiguate.
   - If exactly one key is set, use that provider.
   - If neither key is set, return an error.

Supported key variables:

- Claude: `CLAUDE_API_KEY` or `ANTHROPIC_API_KEY` (either is accepted).
- Google: `GOOGLE_API_KEY` or `GEMINI_API_KEY` (either is accepted).

## Claude (`lib/anthropic.ts`)

- Uses the official `@anthropic-ai/sdk` client.
- Model: `claude-sonnet-5-5` (exported as `CLAUDE_MODELS.conversation`). `claude-opus-5-5` is reserved for the future feedback pass and is not wired up.
- Request shape: `messages.stream({ model, max_tokens: 1500, system, messages, output_config: { effort: "low" } })`.
- Streams `content_block_delta` events whose `delta.type === "text_delta"` and yields the text fragments.
- `abort()` calls `stream.abort()`, which cancels the in-flight HTTP request.

## Google (`lib/google.ts`)

- Calls the Gemini REST endpoint directly with `fetch` and parses Server-Sent Events manually.
- Model: `gemini-3.8-flash`.
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse`.
- Headers: `Content-Type: application/json` and `x-goog-api-key: <key>`.
- Request body:
  - `systemInstruction.parts[0].text` is the system prompt.
  - `contents` is the message list with `role` remapped from `assistant` to `model`.
  - `generationConfig.maxOutputTokens` is `1500`.
- The SSE reader buffers partial lines, splits on `\n`, and only yields chunks whose `part.thought` is falsy. This filters out Gemini's internal reasoning text so only the spoken reply reaches the client.
- Non-2xx responses are mapped to friendly error messages via `googleFailure(response)`. The original error body is included when it is JSON.
- `abort()` calls `controller.abort()`, which cancels the fetch.

## Shared interface

Both functions return `TextReply`, an object with:

- `text: AsyncIterable<string>` — the streamed text fragments.
- `abort: () => void` — cancel the upstream call.

This is what `app/api/chat/route.ts` consumes.

## Notes

- API keys are read only on the server. The browser never sees them.
- The Google path is intentionally minimal and depends on no third-party SDK; if Gemini changes its SSE shape, the parser is the only place that needs an update.
- The `thought` filter on Google is a deliberate choice: chain-of-thought tokens are useful for quality but should not be spoken aloud or shown in the transcript.
