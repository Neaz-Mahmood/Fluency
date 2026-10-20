"use client";

import { ArrowRight, MessageCircle, Briefcase, Coffee, Users } from "lucide-react";
import { SCENARIOS, type ScenarioId } from "@/lib/scenarios";

const SCENARIO_ICONS: Record<string, typeof MessageCircle> = {
  "free-chat": MessageCircle,
  "job-interview": Briefcase,
  cafe: Coffee,
  neighbor: Users,
};

const SCENARIO_TAGS: Record<string, string> = {
  "free-chat": "Spontaneous",
  "job-interview": "Professional",
  cafe: "Daily Life",
  neighbor: "Social",
};

export function ScenarioPicker({
  onSelect,
}: {
  onSelect: (scenarioId: ScenarioId) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 py-2 sm:py-4">
      <div className="flex flex-col items-start gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#06bee1]/35 bg-[#06bee1]/12 px-3 py-1 text-xs font-semibold tracking-wider text-[#03256c] uppercase">
          <span className="size-2 rounded-full bg-[#06bee1] shadow-[0_0_8px_#06bee1]" />
          Select Practice Scenario
        </div>
        <h1 className="font-heading text-3xl font-bold tracking-tight text-[#03256c] sm:text-4xl">
          What do you want to practice?
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-[#556b82] sm:text-base">
          Choose an environment. You will speak aloud, hear an immediate response, and guide the dialogue back and forth.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {SCENARIOS.map((scenario) => {
          const Icon = SCENARIO_ICONS[scenario.id] || MessageCircle;
          const tag = SCENARIO_TAGS[scenario.id] || "Scenario";

          return (
            <button
              key={scenario.id}
              type="button"
              onClick={() => onSelect(scenario.id)}
              className="group relative flex flex-col justify-between rounded-lg border border-[#d8e2ed] bg-white p-6 text-left shadow-[0_2px_8px_-2px_rgba(3,37,108,0.05)] transition-all hover:border-[#1768ac] hover:shadow-[0_8px_24px_-4px_rgba(3,37,108,0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06bee1] focus-visible:ring-offset-1 cursor-pointer"
            >
              <div>
                <div className="mb-4 flex items-center justify-between border-b border-[#d8e2ed] pb-3">
                  <span className="rounded-full border border-[#d8e2ed] bg-[#f4f7fb] px-2.5 py-0.5 text-[11px] font-semibold tracking-wider text-[#0461a4] uppercase">
                    {tag}
                  </span>
                  <span className="flex size-8 items-center justify-center rounded bg-[#f4f7fb] text-[#1768ac] transition-colors group-hover:bg-[#03256c] group-hover:text-white">
                    <Icon className="size-4" />
                  </span>
                </div>
                <h2 className="font-heading text-lg font-semibold text-[#03256c] transition-colors group-hover:text-[#2541b2]">
                  {scenario.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[#556b82]">
                  {scenario.description}
                </p>
              </div>

              <div className="mt-5 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-[#1768ac] uppercase transition-colors group-hover:text-[#2541b2]">
                <span>Begin dialogue</span>
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
