"use server";

import { getDb } from "@/lib/db";
import { deleteCurrentLearner, getLearner, setVoiceConsent } from "@/lib/learner";

export type DeleteDataState = { status: "idle" | "deleted" | "error" };

// The learner comes from the cookie inside deleteCurrentLearner, never from the client,
// because Server Functions can be called with a direct POST.
export async function deleteMyData(): Promise<DeleteDataState> {
  try {
    await deleteCurrentLearner();
    return { status: "deleted" };
  } catch (error) {
    console.error("Could not delete learner data.", error);
    return { status: "error" };
  }
}

export async function updateVoiceConsent(given: unknown): Promise<{ status: "ok" | "error" }> {
  if (typeof given !== "boolean") {
    return { status: "error" };
  }
  try {
    const learner = await getLearner();
    await setVoiceConsent(getDb(), learner.learnerId, given);
    return { status: "ok" };
  } catch (error) {
    console.error("Could not update voice consent.", error);
    return { status: "error" };
  }
}
