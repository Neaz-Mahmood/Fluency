import { describe, expect, it } from "vitest";

import { formatPlacementTranscript, parseAssessment } from "@/lib/placement";

describe("parseAssessment", () => {
  it("accepts plain JSON", () => {
    expect(parseAssessment('{"cefr_speaking": "B1", "cefr_writing": "B2"}')).toEqual({
      speaking: "B1",
      writing: "B2",
    });
  });

  it("accepts JSON wrapped in prose", () => {
    const text = 'Here is the result: {"cefr_speaking": "A2", "cefr_writing": "B1"}. Good progress.';
    expect(parseAssessment(text)).toEqual({
      speaking: "A2",
      writing: "B1",
    });
  });

  it("accepts JSON wrapped in a code fence", () => {
    const text = '```json\n{"cefr_speaking": "C1", "cefr_writing": "C2"}\n```';
    expect(parseAssessment(text)).toEqual({
      speaking: "C1",
      writing: "C2",
    });
  });

  it("rejects unknown levels", () => {
    expect(parseAssessment('{"cefr_speaking": "B3", "cefr_writing": "A1"}')).toBeNull();
    expect(parseAssessment('{"cefr_speaking": "A1", "cefr_writing": "expert"}')).toBeNull();
  });

  it("rejects missing keys", () => {
    expect(parseAssessment('{"cefr_speaking": "B1"}')).toBeNull();
    expect(parseAssessment('{"cefr_writing": "B1"}')).toBeNull();
    expect(parseAssessment("{}")).toBeNull();
  });

  it("rejects invalid JSON", () => {
    expect(parseAssessment("not json at all")).toBeNull();
    expect(parseAssessment("{ speaking: B1 }")).toBeNull();
    expect(parseAssessment("")).toBeNull();
    expect(parseAssessment("}{")).toBeNull();
  });
});

describe("formatPlacementTranscript", () => {
  it("labels voice, typed, and null input modes correctly", () => {
    const transcript = formatPlacementTranscript([
      { role: "assistant", content: "Hello! Welcome.", inputMode: null },
      { role: "user", content: "Hi there.", inputMode: "voice" },
      { role: "assistant", content: "Tell me about your job.", inputMode: null },
      { role: "user", content: "I work as an engineer.", inputMode: "typed" },
      { role: "assistant", content: "Nice!", inputMode: null },
      { role: "user", content: "Thank you.", inputMode: null },
    ]);

    expect(transcript).toBe(
      [
        "Partner: Hello! Welcome.",
        "Learner (voice): Hi there.",
        "Partner: Tell me about your job.",
        "Learner (typed): I work as an engineer.",
        "Partner: Nice!",
        "Learner (typed): Thank you.",
      ].join("\n"),
    );
  });
});
