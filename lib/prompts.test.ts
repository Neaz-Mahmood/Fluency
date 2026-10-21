import { describe, expect, it } from "vitest";

import { getSystemPrompt, type PromptLearner } from "@/lib/prompts";

const EMPTY_LEARNER: PromptLearner = {
  cefrSpeaking: null,
  nativeLanguage: null,
  compactTutorSummary: "",
};

describe("getSystemPrompt", () => {
  it("equals the base and scenario prompt when level is null and summary is empty", () => {
    const prompt = getSystemPrompt("free-chat", EMPTY_LEARNER);
    expect(prompt).toBe(
      [
        "You are Fluency, a patient English conversation partner. The learner is practicing spoken English with you.",
        "",
        "Rules:",
        "- Reply in plain spoken English, usually one to three short sentences.",
        "- Stay inside the scenario and ask one natural follow-up so the conversation can continue.",
        "- Use everyday words. If you use a less common word, make its meaning clear from the sentence.",
        "- Do not lecture, do not list corrections, and do not mention that you are an AI unless the learner asks.",
        "- If the learner's English is unclear, answer your best guess and gently rephrase what you think they meant inside your reply.",
        "- No markdown, no bullet points, and no stage directions.",
        "",
        "Scenario: free conversation. Start from the learner's life — their day, work, studies, or plans. Keep it warm and curious.",
      ].join("\n"),
    );
    expect(prompt).not.toContain("Learner level:");
    expect(prompt).not.toContain("What you know about this learner");
  });

  it("picks the beginner block with Bangla help for A1 and A2 with bn-BD native language", () => {
    for (const level of ["A1", "A2"] as const) {
      const prompt = getSystemPrompt("free-chat", {
        cefrSpeaking: level,
        nativeLanguage: "bn-BD",
        compactTutorSummary: "",
      });

      expect(prompt).toContain(`Learner level: ${level} (beginner).`);
      expect(prompt).toContain(
        "- Use short, high-frequency sentences and speak slowly and simply.",
      );
      expect(prompt).toContain(
        "- If the learner is stuck, asks what a word means, or asks how to say something, help briefly in Bangla, then continue in English. It is fine if they mix in Bangla.",
      );
      expect(prompt).toContain("Bangla");
    }
  });

  it("drops the native language bullet for A1 and A2 when native language is null", () => {
    for (const level of ["A1", "A2"] as const) {
      const prompt = getSystemPrompt("free-chat", {
        cefrSpeaking: level,
        nativeLanguage: null,
        compactTutorSummary: "",
      });

      expect(prompt).toContain(`Learner level: ${level} (beginner).`);
      expect(prompt).toContain(
        "- Use short, high-frequency sentences and speak slowly and simply.",
      );
      expect(prompt).not.toContain("Bangla");
      expect(prompt).not.toContain("If the learner is stuck");
    }
  });

  it("picks the intermediate block with Bangla help for B1 with bn-BD native language", () => {
    const prompt = getSystemPrompt("free-chat", {
      cefrSpeaking: "B1",
      nativeLanguage: "bn-BD",
      compactTutorSummary: "",
    });

    expect(prompt).toContain("Learner level: B1 (intermediate).");
    expect(prompt).toContain("- Speak English almost all the time.");
    expect(prompt).toContain(
      "- Use Bangla only to clear up a confusing word or a tricky tense contrast (for example, present perfect vs. simple past), in one short sentence.",
    );
    expect(prompt).toContain("Bangla");
  });

  it("drops the native language bullet for B1 when native language is null", () => {
    const prompt = getSystemPrompt("free-chat", {
      cefrSpeaking: "B1",
      nativeLanguage: null,
      compactTutorSummary: "",
    });

    expect(prompt).toContain("Learner level: B1 (intermediate).");
    expect(prompt).toContain("- Speak English almost all the time.");
    expect(prompt).not.toContain("Bangla");
    expect(prompt).not.toContain("Use Bangla only");
  });

  it("picks the advanced block for B2, C1, C2 and never mentions Bangla", () => {
    for (const level of ["B2", "C1", "C2"] as const) {
      const prompt = getSystemPrompt("free-chat", {
        cefrSpeaking: level,
        nativeLanguage: "bn-BD",
        compactTutorSummary: "",
      });

      expect(prompt).toContain(`Learner level: ${level} (advanced).`);
      expect(prompt).toContain("- Speak only English, including any explanation.");
      expect(prompt).toContain(
        "- Use natural collocations, idioms and register, and match the learner's pace.",
      );
      expect(prompt).not.toContain("Bangla");
    }
  });

  it("includes the base rules 'Do not lecture, do not list corrections' for every level", () => {
    const levels = [null, "A1", "A2", "B1", "B2", "C1", "C2"] as const;
    for (const level of levels) {
      const prompt = getSystemPrompt("free-chat", {
        cefrSpeaking: level,
        nativeLanguage: "bn-BD",
        compactTutorSummary: "",
      });
      expect(prompt).toContain("Do not lecture, do not list corrections");
    }
  });

  it("includes non-empty compactTutorSummary block", () => {
    const summary = "Practicing for a job interview. Has experience in IT.";
    const prompt = getSystemPrompt("job-interview", {
      cefrSpeaking: "B1",
      nativeLanguage: "bn-BD",
      compactTutorSummary: summary,
    });

    expect(prompt).toContain(
      `What you know about this learner from earlier sessions (use it naturally, do not recite it):\n${summary}`,
    );
  });

  it("omits the summary block when compactTutorSummary is whitespace-only", () => {
    const prompt = getSystemPrompt("job-interview", {
      cefrSpeaking: "B1",
      nativeLanguage: "bn-BD",
      compactTutorSummary: "   \n\t  ",
    });

    expect(prompt).not.toContain("What you know about this learner");
  });

  it("falls back to free chat when scenario id is unknown", () => {
    const prompt = getSystemPrompt("non-existent-scenario", EMPTY_LEARNER);
    const freeChatPrompt = getSystemPrompt("free-chat", EMPTY_LEARNER);
    expect(prompt).toBe(freeChatPrompt);
  });
});
