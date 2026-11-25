import { SCENARIOS } from "@/lib/scenarios";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatSessionTitle(session: { mode: string; scenarioId?: string | null }): string {
  if (session.mode === "placement") return "Placement";
  if (session.mode === "writing") return "Writing";
  if (session.scenarioId) {
    const scenario = SCENARIOS.find((item) => item.id === session.scenarioId);
    if (scenario) return scenario.title;
  }
  return "Conversation";
}

export function formatSessionDate(date: Date | string | number): string {
  return dateFormatter.format(typeof date === "object" ? date : new Date(date));
}
