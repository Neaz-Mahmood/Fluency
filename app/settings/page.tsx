import type { Metadata } from "next";

import { DeleteMyData } from "@/components/DeleteMyData";

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
