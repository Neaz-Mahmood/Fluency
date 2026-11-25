# Writing coach

A dedicated writing assistant for reviewing paragraphs, emails, and essays sentence by sentence.

## What it is

The writing coach allows learners to submit written English text (such as an email or paragraph) and receive post-session grammar corrections, fluency upgrades, and vocabulary suggestions through the feedback recap.

## Where it lives

```
app/write/page.tsx             # /write route
app/write/actions.ts           # submitWriting server action
components/WritingCoach.tsx    # Textarea input and character counter interface
lib/sessions.ts                # saveWritingTurn session storage helper
```

## How it works

- The limit is 2,000 characters (`MAX_CHARS` from `lib/chat-request.ts`).
- The text is stored as a `writing` session with one typed turn, ended at once, then corrected sentence by sentence (`splitSentences`) by the same pipeline. The learner lands on the same recap.
- History lists it as "Writing".

## Notes

- Abbreviations like "Mr." split into their own line, which the model skips.
