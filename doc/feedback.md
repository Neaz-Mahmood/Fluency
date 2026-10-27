# Feedback and recap

A post-session review that provides minimal grammar corrections, natural phrasing upgrades, explanations, and vocabulary to remember after a practice conversation.

## What it is

Post-session feedback analyzes the learner's conversation turns once practice ends. It delivers precision-first grammar corrections for real errors, an optional more natural phrasing, explanations tailored to the learner's native language and level, and up to five vocabulary items to review.

## Where it lives

```
lib/feedback.ts                   # Feedback prompt, input formatter, parser, explanationLanguage, splitSentences
lib/feedback-job.ts               # runFeedback background job
lib/feedback-store.ts             # session_feedback and learner_error_patterns persistence
app/practice/actions.ts           # endConversation server action
components/Recap.tsx              # Recap screen layout and error display
components/RecapRefresher.tsx     # Polling refresher while feedback is pending
lib/pronunciation-recap.ts        # Session pronunciation summary, proper-noun filter, tips prompt and parser
lib/pronunciation-job.ts          # runPronunciationFeedback background job
lib/pronunciation-store.ts        # Score loading, pronunciation status and PRONUNCIATION_IPA patterns
components/PronunciationRecap.tsx # Pronunciation section of the recap
app/history/[sessionId]/page.tsx  # Route hosting the transcript and recap
```

## How it works

- **Session end and triggering**: "Finish and get feedback" ends the session and marks `session_feedback` pending. In `after()`, the summary and the feedback job run in parallel.
- **Precision-first prompt**: The prompt is precision-first: the few-shot example is 3/5 error-free and it never asks for a number of errors. Partner lines are context only. Voice lines get no spelling fixes.
- **Parser validation**: The parser drops edits whose `original` isn't in the line.
- **Explanation language**: Explanations are in Bangla for `bn-BD` learners at A1, A2 or no level, and in English otherwise.
- **Error patterns tracking**: `learner_error_patterns`: one pattern per ERRANT code. Voice lines count as `SPEAKING_GRAMMAR`, typed lines as `WRITING_GRAMMAR`. Each occurrence adds to `occurrence_count` and resets `resolved_streak`; a session that uses the modality without repeating the code adds 1 to the streak.
- **Recap display**: The recap shows you said / correct form / more natural, labels an upgrade "Optional: your version was correct" when there were no edits, and adds the explanation and words to remember. While pending, it refreshes every 3 s for up to 2 minutes.
- **Token limit**: `maxTokens: 4000`, because the feedback model's thinking counts toward it.
- **Pronunciation (live voice sessions, FLU-65)**:
  - If the session has spoken learner turns, `session_feedback.pronunciation_status` is set to pending and `runPronunciationFeedback` runs alongside the other jobs.
  - Azure scores each turn in the worker 1–5 s behind the speech, so the job first waits until the session's score count has stopped changing for 6 s (at most 40 s). With no scores at all (Web Speech, or Azure off), the status goes back to null and the section doesn't show.
  - The recap shows the session's accuracy, fluency and rhythm (audio-weighted means), the sound patterns, words below 60 (at most 8), and up to 3 tips from the feedback model. Tips are in the explanation language, and each must name a pattern, word or score from the input.
  - Sound patterns are Azure phoneme mismatches mapped onto the Bangla-speaker catalog (`AZURE_TO_CATALOG` in `lib/pronunciation-patterns.ts`). Words capitalized mid-sentence in the transcript (Mirpur, Zara) are treated as names and dropped, because Azure scores names it doesn't know low.
  - With no patterns, the recap says so and warns that automatic scoring often misses th, f, v and z. It never says there were no errors.
  - The summary is computed from the stored scores on every render. Only the tips are saved.
  - Patterns are recorded in `learner_error_patterns` as `PRONUNCIATION_IPA`, with the same count and streak rules as grammar. They have no correction text, so the live prompt's practice targets never pick them.
  - The recap keeps refreshing while either the corrections or the pronunciation are pending.

## Notes

- Only "Finish and get feedback" and "Switch scenario" end a session. A closed tab leaves it open with no feedback.
- Placement sessions get no recap.
