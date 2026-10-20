"use server";

import { deleteCurrentLearner } from "@/lib/learner";

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
