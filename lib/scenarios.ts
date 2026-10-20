export const SCENARIOS = [
  {
    id: "free-chat",
    title: "Free chat",
    description: "Talk about your day, your plans, or whatever is on your mind.",
  },
  {
    id: "job-interview",
    title: "Job interview",
    description: "Practice answering questions as if you are interviewing for a job.",
  },
  {
    id: "cafe",
    title: "Ordering at a café",
    description: "Order a drink and something to eat, then handle a small change.",
  },
  {
    id: "neighbor",
    title: "Meeting a neighbor",
    description: "Introduce yourself and make small talk with someone new.",
  },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]["id"];

export function isScenarioId(value: string): value is ScenarioId {
  return SCENARIOS.some((scenario) => scenario.id === value);
}
