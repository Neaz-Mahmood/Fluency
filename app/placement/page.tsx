import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { Placement } from "@/components/Placement";
import type { LearnerProfile } from "@/lib/db/schema";
import { getLearner } from "@/lib/learner";
import { getMessages } from "@/lib/messages";

export const metadata: Metadata = {
  title: "Placement",
  description: "Find your English level.",
};

export default function PlacementPage() {
  return (
    <Suspense fallback={null}>
      <PlacementScreen />
    </Suspense>
  );
}

async function PlacementScreen() {
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

  return <Placement messages={getMessages(learner?.nativeLanguage)} />;
}
