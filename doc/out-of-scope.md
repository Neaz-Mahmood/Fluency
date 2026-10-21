# Out of scope

The following are intentionally not in this build. They are listed here so reviewers do not flag them as missing, and so the next phase has a clear starting point.

## Not in this build

- **Accounts** — there is no signup or sign-in. Each browser is an anonymous learner identified by a cookie, and the chat route is open.
- **Post-conversation feedback pass** — there is no grammar correction or vocabulary review at the end of a session. The `claude-opus-5-5` feedback model is used by placement (FLU-30) and the learner summary (FLU-31).
- **Per-user provider overrides** — provider selection is driven entirely by server-side env vars.
- **Voice and rate controls** — the spoken reply is hard-coded to `en-US` at `rate: 0.96`.
- **Custom scenarios** — the four scenarios in `lib/scenarios.ts` are the only options.
- **Analytics, telemetry, and error reporting** — none are wired up.
- **Other languages** — the UI is English or Bangla, and the AI partner always replies in English.
- **Spanish speakers (es → en)** — the next native language. Needs a `lib/languages.ts` entry, a Spanish dictionary in `lib/messages.ts`, a `scripts/eval/golden/es-en.json` golden set, and a Spanish-speaking reviewer. `es-ES`/`es-MX` are already in the `lang_code` enum.

## When a feature lands

When one of these features is built, the matching file in this directory should be added or updated, and this list should be trimmed.
