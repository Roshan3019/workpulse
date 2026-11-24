"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Why this page is inside `/app` rather than at the root.
 *
 * A root `error.tsx` replaces the *entire* document — including the sidebar —
 * with a bare "a server error occurred", which is what the client saw: a black
 * page, no navigation, no clue which part of the app failed, and a reload
 * button that just fails again. Placing it here keeps the shell (and the way
 * out) on screen, and — importantly — a failure in one card does not take the
 * whole dashboard down with it.
 *
 * It also translates the two database faults we can actually explain into
 * something a person can act on, instead of a stack trace:
 *   • a missing migration → "finish setting up the database"
 *   • anything else       → "try again", with the reference kept for support
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  useEffect(() => {
    // Stays in the server log (the browser console is not a support channel).
    console.error(`[app] ${pathname} failed:`, error.message);
  }, [error, pathname]);

  const message = error?.message ?? "";
  const missingMigration =
    /task_assignees|PGRST20\d|does not exist|schema cache/i.test(message) &&
    /(relation|table|relationship|column)/i.test(message);
  const reference = error.digest ?? null;

  return (
    <div className="mx-auto max-w-[560px] py-10">
      <div className="card p-6 sm:p-8">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-soft text-brand-dark">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </span>

        <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">
          {missingMigration ? "The database is missing an update" : "Something went wrong here"}
        </h1>

        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          {missingMigration ? (
            <>
              This page needs a newer database schema than the one it found. Run the migrations in{" "}
              <code className="rounded bg-[#f6f3ee] px-1 py-0.5 text-[12.5px]">supabase/migrations/</code>{" "}
              in numeric order (the last one is <b>0010</b>), then reload. Everything else keeps
              working meanwhile.
            </>
          ) : (
            <>
              The page could not be built. This is usually a momentary problem — try again, and if it
              keeps happening the reference below is what to send us.
            </>
          )}
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={reset} className="btn-primary h-11 flex-1">
            Try again
          </button>
          <Link href="/app" className="btn-outline flex h-11 flex-1 items-center justify-center">
            Back to dashboard
          </Link>
        </div>

        {reference ? (
          <p className="mt-4 border-t border-line pt-3 text-[11.5px] text-faint">
            Reference <code className="select-all">{reference}</code>
          </p>
        ) : null}
      </div>
    </div>
  );
}
