import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { WritingCoach } from "@/components/WritingCoach";
import type { LearnerProfile } from "@/lib/db/schema";
import { getLearner } from "@/lib/learner";
import { getMessages } from "@/lib/messages";

export const metadata: Metadata = {
  title: "Writing coach",
  description: "Get feedback on an email or paragraph.",
};

export default function WritePage() {
  return (
    <Suspense fallback={null}>
      <WriteScreen />
    </Suspense>
  );
}

async function WriteScreen() {
  let learner: LearnerProfile | null = null;
  try {
    learner = await getLearner();
  } catch (error) {
    unstable_rethrow(error);
    console.error("Could not load the learner.", error);
  }

  if (learner && learner.nativeLanguage === null) {
    redirect("/onboarding");
  }

  return <WritingCoach messages={getMessages(learner?.nativeLanguage)} />;
}
