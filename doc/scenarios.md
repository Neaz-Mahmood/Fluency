# Scenarios

The scenario picker is the first screen inside the practice route. It lets you pick what kind of conversation you want to rehearse, and feeds the choice into the system prompt that the AI partner responds from.

## What it is

Four preset scenarios, each with a title, a one-sentence description, and a tag that signals the register of the conversation. Picking one sets the persona and rules the AI partner follows for the rest of the session.

## Where it lives

```
lib/scenarios.ts          # Source of truth: SCENARIOS, ScenarioId, isScenarioId
components/ScenarioPicker.tsx  # Picker UI: icons, tags, hover/focus states
lib/prompts.ts            # Per-scenario behavior, composed into the system prompt
```

## How it works

- The four scenarios are defined as a `const` tuple in `lib/scenarios.ts`. The `id` field is the stable identifier and `ScenarioId` is derived from it.
- `isScenarioId(value)` narrows a raw string into `ScenarioId` and is used to validate both the picker and the API request.
- `components/ScenarioPicker.tsx` maps each id to a Lucide icon and a tag string. The tags are:

  | Id | Title | Tag |
  | --- | --- | --- |
  | `free-chat` | Free chat | Spontaneous |
  | `job-interview` | Job interview | Professional |
  | `cafe` | Ordering at a café | Daily Life |
  | `neighbor` | Meeting a neighbor | Social |

- The `ScenarioPicker` receives an `onSelect(scenarioId)` callback. In `<Conversation />` the callback resets the transcript, calls `interrupt()` to clean up any in-flight state, and stores the choice in `scenarioId` state.
- Once a scenario is chosen, `lib/prompts.ts` composes a system prompt by combining a base "Fluency" persona with a per-scenario block (`SCENARIO_PROMPTS`). Unknown scenario ids fall back to `free-chat`.
- `getSystemPrompt(scenarioId, learner)` then appends level-specific scaffolding rules based on `cefrSpeaking` (with optional native-language assistance for A1–B1) and past session context from `compactTutorSummary`.

## Notes

- Scenario ids are kebab-case and the React component is PascalCase, matching the rest of the codebase.
- The picker is the only entry point; there is no custom-scenario support in this build.
- Switching scenarios mid-conversation clears the transcript and interrupts any in-flight request, TTS, or recognition session.
