"use client";

import { startTransition, useActionState, useState } from "react";
import { Trash2 } from "lucide-react";

import { deleteMyData, type DeleteDataState } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";

export function DeleteMyData() {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<DeleteDataState>(deleteMyData, {
    status: "idle",
  });

  if (state.status === "deleted") {
    return (
      <p
        role="status"
        className="rounded border border-[#06bee1]/35 bg-[#06bee1]/12 px-3 py-2 text-sm font-medium text-[#03256c]"
      >
        Your data was deleted. Next time you practice, you start fresh.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {state.status === "error" ? (
        <p
          role="alert"
          className="rounded border border-[#ba1a1a]/20 bg-[#ffdad6] px-3 py-2 text-xs font-medium text-[#93000a]"
        >
          Your data could not be deleted. Try again in a moment.
        </p>
      ) : null}

      {confirming ? (
        <div className="flex flex-col gap-3 rounded border border-[#ba1a1a]/20 bg-[#ffdad6]/40 p-4">
          <p className="text-sm text-[#93000a]">
            This permanently deletes everything Fluency saved for you. It can&apos;t be undone.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={pending}
              onClick={() => startTransition(action)}
              className="gap-2 rounded bg-[#ba1a1a] text-white hover:bg-[#93000a]"
            >
              <Trash2 className="size-4" />
              {pending ? "Deleting…" : "Yes, delete everything"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="rounded"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirming(true)}
            className="gap-2 rounded border-[#ba1a1a]/40 text-[#ba1a1a] hover:border-[#ba1a1a] hover:bg-[#ffdad6]/40"
          >
            <Trash2 className="size-4" />
            Delete my data
          </Button>
        </div>
      )}
    </div>
  );
}
