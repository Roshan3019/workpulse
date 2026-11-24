"use client";

import { useEffect } from "react";

/**
 * A member's task list is the one page they cannot leave — there is no
 * "dashboard" for them to go back to — so it gets its own boundary that keeps
 * the page usable rather than bouncing them to a generic error screen.
 */
export default function MyTasksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/my-tasks]", error.message);
  }, [error]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="h1">Your tasks</h1>
        <p className="lede">This list could not be loaded just now.</p>
      </div>

      <div className="card p-5">
        <p className="text-[13.5px] leading-relaxed text-muted">
          Nothing has been lost — your tasks are still saved. Try loading the list again; if it
          keeps failing, tell your admin and quote reference{" "}
          <code className="select-all rounded bg-[#f6f3ee] px-1 py-0.5 text-[12px]">
            {error.digest ?? "unknown"}
          </code>
          .
        </p>
        <button type="button" onClick={reset} className="btn-primary mt-4 h-11">
          Reload my tasks
        </button>
      </div>
    </div>
  );
}
