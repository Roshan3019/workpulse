"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTaskAction } from "@/lib/actions/tasks";

export function DeleteTaskButton({ taskId, title }: { taskId: string; title: string }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  if (confirming) {
    return (
      <span className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await deleteTaskAction(taskId);
              setConfirming(false);
              router.refresh();
            })
          }
          className="rounded-lg bg-bad px-2.5 py-1.5 text-[12px] font-bold text-white"
        >
          {pending ? "Deleting…" : "Delete"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg px-2 py-1.5 text-[12px] font-bold text-muted"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label={`Delete ${title}`}
      title={`Delete ${title}`}
      className="grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-[#fdecec] hover:text-[#b91c1c]"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
        <path d="M10 11v6M14 11v6" />
      </svg>
    </button>
  );
}
