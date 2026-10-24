# Evaluation harness

An offline harness that evaluates grammar-correction prompts against golden sets of learner sentences.

## What it is

A CLI tool that runs a corrector function over golden-set sentences, measures edit counts and over-correction rate on error-free sentences, and outputs a formatted report.

## Where it lives

```
scripts/eval/eval.ts            # Harness logic: parsing, scoring, formatting, CLI entry point
scripts/eval/golden/bn-en.json  # Golden set of Bangla-speaker English sentences
scripts/eval/eval.test.ts       # Unit tests for parsing, scoring, and golden sets
```

## How it works

- **Prompt execution**: The harness runs the real correction prompt (`lib/feedback.ts`) against the feedback model, in batches of 20.
- **Span matching & metrics**: Edit matching uses normalized spans, and F0.5 is edit-level, not ERRANT.
- **File format**: Golden sets are JSON arrays of items with string `id`/`input`, `expected_edits` array of `{ original, correction }`, and boolean `is_error_free` matching `expected_edits.length === 0`.
- **How to run**:
  - `pnpm eval`: Runs the real corrector against `scripts/eval/golden/bn-en.json`, scores predictions, and enforces the gate.
  - `pnpm eval -- --no-model`: Runs the offline baseline without calling the model.
  - `pnpm eval -- --write-baseline`: Records `scripts/eval/baseline.json` after a passing run.
- **Exit codes**:
  - `0`: Successful evaluation run passing all gates.
  - `1`: The exit code is 1 when over-correction reaches 5% or rises by more than one sentence over the baseline.
  - `2`: The exit code is 2 when no Claude/OpenCode provider is configured.
- **What the numbers mean**:
  - `Sentences`: Total items and error-free items count.
  - `Over-correction`: Error-free items with ≥1 predicted edit over total error-free items (0% when error-free is 0).
  - `Edits`: Count of expected edits, predicted edits, and matched edits (each expected edit matched at most once via normalized spans).
  - `Edit F0.5`: Harmonic mean weighting precision over recall (beta = 0.5) across normalized edit spans.

## Current baseline

Measured 2026-10-22 on 200 bn → en sentences (`scripts/eval/golden/bn-en.json`, 100 error-free) using `claude-opus-5-5` via OpenCode:

- **Over-correction**: 0/100 (0.0%)
- **Edits**: expected 100, predicted 97, matched 93
- **Edit F0.5**: 0.953 (precision 0.959, recall 0.930), on normalized span match, not ERRANT
- Recorded in `scripts/eval/baseline.json`.

## Notes

- The golden set is model-drafted. Claude fixed 4 items; the rest await a Bangla-speaking reviewer. Three contested South Asian usages are still marked as errors: #129 "give the exam", #139 "congratulated me for", #153 "took admission in".
- Clean textbook sentences probably overstate real-transcript quality; add sentences from real sessions once there are some.
- A live run takes over 10 minutes; the first attempt failed on a network reset (`ECONNRESET`), and the harness has no retry.
- Zero external dependencies: Node 26 executes `eval.ts` directly via native type stripping with `--conditions=react-server`.
