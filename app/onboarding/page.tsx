import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { LanguageForm } from "@/components/LanguageForm";
import { isNativeLanguage, type NativeLanguage } from "@/lib/languages";
import { getLearner } from "@/lib/learner";

export const metadata: Metadata = {
  title: "Welcome",
  description: "Choose your language.",
};

export default function OnboardingPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="border-b border-[#d8e2ed] pb-4">
        <h1 className="font-heading text-2xl font-bold text-[#03256c] sm:text-3xl">
          Welcome to Fluency · Fluency-তে স্বাগতম
        </h1>
        <p className="mt-2 text-sm text-[#556b82]">
          Which language do you speak? · আপনি কোন ভাষায় কথা বলেন?
        </p>
      </div>

      <section className="flex flex-col gap-4 rounded-lg border border-[#d8e2ed] bg-white p-5 shadow-[0_2px_8px_-2px_rgba(3,37,108,0.05)]">
        <Suspense fallback={null}>
          <OnboardingLanguage />
        </Suspense>
      </section>
    </div>
  );
}

async function OnboardingLanguage() {
  let current: NativeLanguage | undefined;
  try {
    const learner = await getLearner();
    if (isNativeLanguage(learner.nativeLanguage)) {
      current = learner.nativeLanguage;
    }
  } catch (error) {
    unstable_rethrow(error);
  }

  return <LanguageForm current={current} />;
}
