# Placement Assessment

A short diagnostic chat that estimates provisional CEFR levels for a new learner.

## Where it lives

```
lib/placement.ts                   # CEFR levels, ASSESSMENT_PROMPT, transcript formatting and parsing
app/placement/actions.ts           # finishPlacement server action
app/placement/page.tsx             # /placement route
components/Placement.tsx           # Diagnostic chat interface and results display
components/ConversationControls.tsx # Shared voice and text conversation controls
app/api/chat/route.ts              # POST /api/chat (placement mode and answer limit)
lib/prompts.ts                     # getPlacementPrompt
```

## UI flow

1. **Access**: Learners without CEFR levels are directed to `/placement` after completing onboarding (`/onboarding`). Existing learners can retake placement at any time from the Level section in `/settings`.
2. **Diagnostic conversation**: Rendered by `<Placement />` using the shared `useConversation` hook with `mode: "placement"` and `maxAnswers: 6`. The header tracks answer count (`Answers: X/6`).
3. **Turn limit**: When the 6th user answer is submitted and the partner finishes its reply, `<ConversationControls />` is replaced with a "See my level" button. Further speech recognition and input are disabled.
4. **Scoring & results**: The button calls `finishPlacement(sessionId)` via `useActionState`. Upon completion, provisional speaking and writing CEFR levels are displayed with a button linking to `/practice`.

## How it works

1. **Session & Chat**: The client starts a chat with `mode: "placement"` via `POST /api/chat`. No scenario is provided.
2. **Turn Limit**: The chat allows at most `PLACEMENT_MAX_ANSWERS = 6` learner answers. Sending a 7th user answer returns `409 Conflict` ("Placement is finished.").
3. **Assessment**: When the conversation finishes, the client calls `finishPlacement(sessionId)`.
4. **Scoring**:
   - Loads the session turns and formats the transcript, marking each learner line with `(voice)` or `(typed)` (null input mode counts as typed).
   - Calls the feedback model (`generateText` with `model: "feedback"` and `ASSESSMENT_PROMPT`) to produce JSON: `{"cefr_speaking": "<level>", "cefr_writing": "<level>"}` where levels are `A1`–`C2`.
   - `parseAssessment` extracts the JSON and validates both levels against `CEFR_LEVELS`.
5. **Persistence**:
   - Writes provisional levels to `learner_profiles`: `cefr_speaking` and `cefr_writing`; `cefr_listening` and `cefr_reading` default to the speaking level.
   - Ends the session by setting `ended_at = new Date()`.
   - If model output cannot be parsed, logs the raw text, writes nothing, and returns `{ status: "error" }`.
