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

- **File format**: Golden sets are JSON arrays of items with string `id`/`input`, `expected_edits` array of `{ original, correction }`, and boolean `is_error_free` matching `expected_edits.length === 0`.
- **How to run**: `pnpm eval` parses `scripts/eval/golden/bn-en.json`, runs the corrector, scores predictions, and prints the summary.
- **What the numbers mean**:
  - `Sentences`: Total items and error-free items count.
  - `Over-correction`: Error-free items with ≥1 predicted edit over total error-free items (0% when error-free is 0).
  - `Edits`: Count of expected edits, predicted edits, and exact matched edits (each expected edit matched at most once).

## Notes

- Uses a baseline `noEdits` corrector until Phase 3 swaps in the real LLM correction prompt.
- To plug in a corrector in Phase 3, provide an implementation conforming to `Corrector = (input: string) => Promise<Edit[]>`.
- Zero external dependencies: Node 26 executes `eval.ts` directly via native type stripping.
