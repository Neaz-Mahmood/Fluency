"use server";

import { redirect } from "next/navigation";

import { getDb } from "@/lib/db";
import { isNativeLanguage } from "@/lib/languages";
import { getLearner, setNativeLanguage } from "@/lib/learner";

export type OnboardingState = { status: "idle" | "error" };

export async function saveLanguages(
  _previous: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const nativeLanguage = formData.get("nativeLanguage");
  if (!isNativeLanguage(nativeLanguage)) {
    return { status: "error" };
  }

  let target = "/practice";
  try {
    const learner = await getLearner();
    await setNativeLanguage(getDb(), learner.learnerId, nativeLanguage);
    if (learner.cefrSpeaking === null) {
      target = "/placement";
    }
  } catch (error) {
    console.error("Could not save native language.", error);
    return { status: "error" };
  }

  redirect(target);
}
