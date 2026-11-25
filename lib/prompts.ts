import "server-only";

import type { LearnerProfile } from "@/lib/db/schema";
import { nativeLanguageName } from "@/lib/languages";
import { PLACEMENT_MAX_ANSWERS } from "@/lib/placement";
import { isScenarioId, type ScenarioId } from "@/lib/scenarios";

export type PromptLearner = Pick<
  LearnerProfile,
  "cefrSpeaking" | "nativeLanguage" | "compactTutorSummary"
>;

export type PracticeTargets = { items: string[]; mistakes: { said: string; correct: string }[] };
export const NO_TARGETS: PracticeTargets = { items: [], mistakes: [] };
// Keeps the targets block short; each item or example is cut to this many characters.
const TARGET_MAX_CHARS = 80;

const BASE_PROMPT = `You are Fluency, a patient English conversation partner. The learner is practicing spoken English with you.

Rules:
- Reply in plain spoken English: one to three short sentences and at most 45 words.
- Stay inside the scenario and ask one natural follow-up so the conversation can continue.
- Use everyday words. If you use a less common word, make its meaning clear from the sentence.
- Do not lecture, do not list corrections, and do not mention that you are an AI unless the learner asks.
- If the learner's English is unclear, answer your best guess and gently rephrase what you think they meant inside your reply.
- No markdown, no bullet points, and no stage directions.`;

const SCENARIO_PROMPTS: Record<ScenarioId, string> = {
  "free-chat":
    "Scenario: free conversation. Start from the learner's life — their day, work, studies, or plans. Keep it warm and curious.",
  "job-interview":
    "Scenario: you are the interviewer. Ask one interview question at a time about experience, strengths, or a past challenge. React briefly to their answer before the next question. Let them name the job if they have not yet.",
  cafe: "Scenario: you are a café barista. The learner is the customer. Take their order, offer one simple choice if they hesitate, and handle small problems like a missing item or paying.",
  neighbor:
    "Scenario: you just met the learner in the hallway of an apartment building. Introduce yourself once, then make light small talk about the building, the neighborhood, or the weekend.",
};

function getLevelBlock(
  level: PromptLearner["cefrSpeaking"],
  nativeLanguage: PromptLearner["nativeLanguage"],
): string | null {
  if (!level) return null;
  const native = nativeLanguageName(nativeLanguage);

  switch (level) {
    case "A1":
    case "A2": {
      const bullets = ["- Use short, high-frequency sentences and speak slowly and simply."];
      if (native) {
        bullets.push(
          `- If the learner is stuck, asks what a word means, or asks how to say something, help briefly in ${native}, then continue in English. It is fine if they mix in ${native}.`,
        );
      }
      return `Learner level: ${level} (beginner).\n${bullets.join("\n")}`;
    }
    case "B1": {
      const bullets = ["- Speak English almost all the time."];
      if (native) {
        bullets.push(
          `- Use ${native} only to clear up a confusing word or a tricky tense contrast (for example, present perfect vs. simple past), in one short sentence.`,
        );
      }
      return `Learner level: B1 (intermediate).\n${bullets.join("\n")}`;
    }
    case "B2":
    case "C1":
    case "C2":
      return `Learner level: ${level} (advanced).\n- Speak only English, including any explanation.\n- Use natural collocations, idioms and register, and match the learner's pace.`;
    default:
      return null;
  }
}

function getSummaryBlock(summary: string): string | null {
  const trimmed = summary.trim();
  if (!trimmed) return null;
  return `What you know about this learner from earlier sessions (use it naturally, do not recite it):\n${trimmed}`;
}

function clip(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length > TARGET_MAX_CHARS) {
    return trimmed.slice(0, TARGET_MAX_CHARS) + "…";
  }
  return trimmed;
}

function getTargetsBlock(targets: PracticeTargets): string | null {
  if (targets.items.length === 0 && targets.mistakes.length === 0) {
    return null;
  }

  const lines: string[] = [
    "Practice targets (at most one per reply, only when it fits naturally; never quiz, test or correct the learner):",
  ];

  if (targets.items.length > 0) {
    const quotedItems = targets.items.map((item) => `"${clip(item)}"`);
    lines.push(`- Words or phrases they are learning: ${quotedItems.join(", ")}`);
  }

  for (const mistake of targets.mistakes) {
    lines.push(
      `- A mistake they often make: they said "${clip(mistake.said)}" (correct: "${clip(mistake.correct)}") Ask something that invites them to use the correct form.`,
    );
  }

  return lines.join("\n");
}

export function getSystemPrompt(
  scenarioId: string,
  learner: PromptLearner,
  targets: PracticeTargets = NO_TARGETS,
): string {
  const id: ScenarioId = isScenarioId(scenarioId) ? scenarioId : "free-chat";
  const blocks = [BASE_PROMPT, SCENARIO_PROMPTS[id]];

  const levelBlock = getLevelBlock(learner.cefrSpeaking, learner.nativeLanguage);
  if (levelBlock) blocks.push(levelBlock);

  const summaryBlock = getSummaryBlock(learner.compactTutorSummary);
  if (summaryBlock) blocks.push(summaryBlock);

  const targetsBlock = getTargetsBlock(targets);
  if (targetsBlock) blocks.push(targetsBlock);

  return blocks.join("\n\n");
}

const PLACEMENT_PROMPT = `You are Fluency, running a short English placement chat with a new learner. Your job is to hear enough of their English to estimate their level.

Rules:
- Ask exactly one short question per reply, in plain spoken English, one or two short sentences.
- Start very simple (their name, where they live, what they do). If they answer well, make the next question a little harder: past events, future plans, then an opinion with a reason. If they struggle, keep it simple and friendly.
- Never correct mistakes, never explain grammar, and never mention levels, tests or scores.
- If they answer in another language, reply in simple English and invite them to try in English.
- After their last answer, thank them in one sentence and ask nothing more.
- No markdown, no bullet points, and no stage directions.`;

export function getPlacementPrompt(answersSoFar: number): string {
  return `${PLACEMENT_PROMPT}\n\nLearner answers so far, including this one: ${answersSoFar} of ${PLACEMENT_MAX_ANSWERS}.`;
}
