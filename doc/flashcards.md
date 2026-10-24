# Flashcards and review

Spaced-repetition flashcards generated from recap feedback and vocabulary, scheduled with FSRS and reviewed with AI-generated cloze sentences.

## What it is

Learners can save grammar corrections and vocabulary items from session recaps into flashcards. Due cards are reviewed at `/review` using spoken or typed recall against AI-generated fill-in-the-blank sentences, scheduled according to the Free Spaced Repetition Scheduler (FSRS).

## Where it lives

```
lib/cards.ts                   # Card persistence, due-card queries, and review logging
lib/fsrs.ts                    # ts-fsrs wrapper, grading, latency thresholds, and answer checking
lib/review.ts                  # AI review sentence prompt, cloze blanking, and item masking
app/history/actions.ts         # saveRecapCard server action
app/review/actions.ts          # startReview and submitReview server actions
app/review/page.tsx            # /review route
components/Review.tsx          # Card review interface with voice and typed input
components/SaveCardButton.tsx  # "Save as card" button on recap items
```

## How it works

- **Saving:** An edit becomes a `GRAMMAR_PATTERN` card (target = corrected span, native text = explanation, context = corrected sentence), and a word becomes a `VOCABULARY` card. The action takes indexes into the stored feedback, never text from the browser. Cards are unique on (learner, type, item).
- **Review:** The earliest due card is shown. The conversation model writes a fresh sentence with the item blanked; if that fails, the saved context sentence is used. The item is also masked in the native-language prompt.
- **Grading:**
  - The answer check normalizes case, punctuation and curly quotes. It is correct, or close (a small edit distance, or the same 4-letter roots), or wrong.
  - Ratings: wrong → Again, close → Hard, correct → Easy, Good or Hard by latency.
  - Thresholds: spoken under 4 s Easy and up to 10 s Good; typed under 6 s and up to 15 s (1.5× spoken, a judgment call). After 30 reviews in a mode they become 0.8× and 2× that learner's median.
- **Scheduling:** `ts-fsrs` 5.4.2 with the learner's stored `fsrs_parameters` (default FSRS-6 weights, retention 0.9, max interval 365 days, fuzz on, steps 1m/10m, relearning 10m). Each review logs its mode, latency and the generated sentence in `fsrs_review_logs`.

## Notes

- Pronunciation drills come in Phase 4.
- Per-learner weight optimization comes after the MVP.
