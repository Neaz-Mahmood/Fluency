import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { DeleteMyData } from "@/components/DeleteMyData";
import { VoiceConsent } from "@/components/VoiceConsent";
import { NATIVE_LANGUAGES } from "@/lib/languages";
import { getLearner } from "@/lib/learner";
import { getMessages } from "@/lib/messages";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage the data Fluency keeps for you.",
};

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="border-b border-[#d8e2ed] pb-4">
        <h1 className="font-heading text-2xl font-bold text-[#03256c] sm:text-3xl">Settings</h1>
      </div>

      <Suspense fallback={null}>
        <LearnerSettings />
      </Suspense>

      <section className="flex flex-col gap-4 rounded-lg border border-[#d8e2ed] bg-white p-5 shadow-[0_2px_8px_-2px_rgba(3,37,108,0.05)]">
        <div className="flex flex-col gap-1.5">
          <h2 className="font-heading text-lg font-semibold text-[#03256c]">Your data</h2>
          <p className="text-sm leading-relaxed text-[#556b82]">
            Fluency saves your learner profile, conversations, flashcards and practice time so it
            can pick up where you left off. They are linked to this browser.
          </p>
        </div>
        <DeleteMyData />
      </section>
    </div>
  );
}

async function LearnerSettings() {
  let languageLabel = "Not set";
  let levelLabel = "Not set";
  let learner: Awaited<ReturnType<typeof getLearner>> | null = null;
  try {
    const profile = await getLearner();
    learner = profile;
    const match = NATIVE_LANGUAGES.find((lang) => lang.code === profile.nativeLanguage);
    if (match) {
      languageLabel = match.label;
    }
    if (profile.cefrSpeaking && profile.cefrWriting) {
      levelLabel = `Speaking: ${profile.cefrSpeaking} · Writing: ${profile.cefrWriting}`;
    }
  } catch (error) {
    unstable_rethrow(error);
  }

  const messages = learner ? getMessages(learner.nativeLanguage) : null;

  return (
    <>
      <section className="flex flex-col gap-4 rounded-lg border border-[#d8e2ed] bg-white p-5 shadow-[0_2px_8px_-2px_rgba(3,37,108,0.05)]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 className="font-heading text-lg font-semibold text-[#03256c]">Language</h2>
            <p className="text-sm text-[#556b82]">{languageLabel}</p>
          </div>
          <Link
            href="/onboarding"
            className="text-sm font-medium text-[#1768ac] hover:text-[#03256c] hover:underline"
          >
            Change
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-[#d8e2ed] bg-white p-5 shadow-[0_2px_8px_-2px_rgba(3,37,108,0.05)]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 className="font-heading text-lg font-semibold text-[#03256c]">Level</h2>
            <p className="text-sm text-[#556b82]">{levelLabel}</p>
          </div>
          <Link
            href="/placement"
            className="text-sm font-medium text-[#1768ac] hover:text-[#03256c] hover:underline"
          >
            Take the placement chat
          </Link>
        </div>
      </section>

      {learner && messages ? (
        <section className="flex flex-col gap-4 rounded-lg border border-[#d8e2ed] bg-white p-5 shadow-[0_2px_8px_-2px_rgba(3,37,108,0.05)]">
          <div className="flex flex-col gap-1.5">
            <h2 className="font-heading text-lg font-semibold text-[#03256c]">
              {messages.voiceConsent.title}
            </h2>
          </div>
          <VoiceConsent given={learner.voiceConsentAt !== null} messages={messages} />
        </section>
      ) : null}
    </>
  );
}
