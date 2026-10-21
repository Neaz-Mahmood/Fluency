# Out of scope

The following are intentionally not in this build. They are listed here so reviewers do not flag them as missing, and so the next phase has a clear starting point.

## Not in this build

- **Accounts** — there is no signup, sign-in, or per-user storage. The chat route is open.
- **Saved transcripts** — conversations are kept only in component state and are lost on refresh.
- **Post-conversation feedback pass** — there is no grammar correction or vocabulary review at the end of a session. The `claude-opus-5-5` feedback model is used by placement (FLU-30) and the learner summary (FLU-31).
- **Per-user provider overrides** — provider selection is driven entirely by server-side env vars.
- **Voice and rate controls** — the spoken reply is hard-coded to `en-US` at `rate: 0.96`.
- **Custom scenarios** — the four scenarios in `lib/scenarios.ts` are the only options.
- **Persistent memory across sessions** — the AI partner does not remember prior conversations.
- **Analytics, telemetry, and error reporting** — none are wired up.
- **Internationalization** — the UI is English-only; the AI partner responds in English.

## When a feature lands

When one of these features is built, the matching file in this directory should be added or updated, and this list should be trimmed.
