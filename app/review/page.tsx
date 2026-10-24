import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { Review } from "@/components/Review";
import type { LearnerProfile } from "@/lib/db/schema";
import { getLearner } from "@/lib/learner";
import { getMessages } from "@/lib/messages";

export const metadata: Metadata = {
  title: "Review",
  description: "Review your saved flashcards.",
};

export default function ReviewPage() {
  return (
    <Suspense fallback={null}>
      <ReviewScreen />
    </Suspense>
  );
}

async function ReviewScreen() {
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

  const messages = getMessages(learner?.nativeLanguage);
  return <Review messages={messages} />;
}
