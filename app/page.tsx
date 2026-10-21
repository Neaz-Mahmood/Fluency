import { Suspense } from "react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { ArrowRight, Headphones, MessageSquareText, Mic } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getLearner } from "@/lib/learner";
import { getMessages } from "@/lib/messages";

const STEP_ICONS = [Mic, MessageSquareText, Headphones];

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  let nativeLanguage: string | null = null;
  try {
    nativeLanguage = (await getLearner()).nativeLanguage;
  } catch (error) {
    unstable_rethrow(error);
    console.error("Could not load the learner.", error);
  }
  const { home } = getMessages(nativeLanguage);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-14 py-4 sm:py-8">
      {/* Hero Section */}
      <section className="flex flex-col items-start gap-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#06bee1]/35 bg-[#06bee1]/12 px-3 py-1 text-xs font-semibold tracking-wider text-[#03256c] uppercase">
          <span className="size-2 rounded-full bg-[#06bee1] shadow-[0_0_8px_#06bee1]" />
          {home.badge}
        </div>

        <h1 className="max-w-2xl font-heading text-4xl font-bold tracking-tight text-[#03256c] sm:text-5xl lg:text-6xl">
          {home.title}
        </h1>

        <p className="max-w-xl text-base leading-relaxed text-[#556b82] sm:text-lg">
          {home.description}
        </p>

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <Button
            nativeButton={false}
            render={<Link href="/practice" />}
            size="lg"
            className="group gap-2.5 rounded"
          >
            {home.startPracticing}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Button>

          <Button
            nativeButton={false}
            render={<Link href="/practice" />}
            variant="outline"
            size="lg"
            className="rounded"
          >
            {home.browseScenarios}
          </Button>
        </div>
      </section>

      {/* Feature Cards Grid (Level 1 Surfaces) */}
      <section className="grid gap-6 sm:grid-cols-3">
        {home.steps.map((step, index) => {
          const Icon = STEP_ICONS[index];
          return (
            <article
              key={step.number}
              className="group flex flex-col rounded-lg border border-[#d8e2ed] bg-white p-6 shadow-[0_2px_8px_-2px_rgba(3,37,108,0.05)] transition-all hover:border-[#1768ac] hover:shadow-[0_8px_24px_-4px_rgba(3,37,108,0.08)]"
            >
              <div className="mb-4 flex items-center justify-between border-b border-[#d8e2ed] pb-4">
                <span className="rounded-full border border-[#d8e2ed] bg-[#f4f7fb] px-2.5 py-0.5 text-[11px] font-semibold tracking-widest text-[#0461a4] uppercase">
                  {step.number}
                </span>
                <span className="flex size-8 items-center justify-center rounded bg-[#f4f7fb] text-[#1768ac] transition-colors group-hover:bg-[#03256c] group-hover:text-white">
                  <Icon className="size-4" />
                </span>
              </div>
              <h2 className="font-heading text-lg font-semibold text-[#03256c] transition-colors group-hover:text-[#2541b2]">
                {step.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[#556b82]">
                {step.body}
              </p>
            </article>
          );
        })}
      </section>

      {/* Surface Subtle Informational Panel */}
      <section className="rounded-lg border border-[#d8e2ed] bg-[#f4f7fb] p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <span className="text-[11px] font-semibold tracking-wider text-[#0461a4] uppercase">
              {home.panelBadge}
            </span>
            <h3 className="font-heading text-xl font-semibold text-[#03256c]">
              {home.panelTitle}
            </h3>
            <p className="max-w-xl text-sm text-[#556b82]">
              {home.panelBody}
            </p>
          </div>
          <div className="flex shrink-0 items-center">
            <Button
              nativeButton={false}
              render={<Link href="/practice" />}
              variant="secondary"
              className="rounded"
            >
              {home.panelCta}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
