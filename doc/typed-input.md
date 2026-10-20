# Typed input

A plain text input sits below the mic button. It is always present, so users on browsers without a working microphone — or anyone who prefers typing — can still drive the conversation.

## What it is

A text field and a Send button. Submitting the form sends the draft through the same `sendUserText` pipeline that the voice path uses.

## Where it lives

```
components/Conversation.tsx  # <form> with <input id="line"> and Send <Button>
```

## How it works

- The draft is held in `draft` state and bound to the input. Pressing Enter or clicking Send calls `onSubmit`, which prevents default and runs `sendUserText(draft)`.
- The input is disabled while `status === "thinking"` so a reply cannot be sent mid-stream.
- The Send button is disabled when the draft is empty/whitespace, mirroring the same guard inside `sendUserText`.
- When speech recognition is unavailable, the component shows a hint above the controls: "Speech recognition is unavailable in this browser. You can type your lines, and replies will be vocalized if audio synthesis is available."

## Notes

- Typed and spoken input share the same downstream code path. Once `sendUserText` is called, the typed text and the spoken transcript are indistinguishable to the rest of the app.
- The form is always visible, even when the mic works, so users can fall back mid-session without a scenario reset.
