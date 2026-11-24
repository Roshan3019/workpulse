import type { Metadata } from "next";
import { Skeleton, SkeletonHeader } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Loading…" };

/**
 * A calm placeholder that mirrors the dashboard.
 *
 * Lives at `/app/loading.tsx` so it covers *every* page under `/app` that does
 * not ship its own. The dashboard is the slowest route (session → members →
 * tasks → teams → join requests → two weeks of availability), so without this
 * a refresh shows a blank tab for as long as the slowest query takes, which
 * reads as "the site is broken", not "the site is busy".
 */
export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading dashboard">
      <SkeletonHeader action={false} />

      {/* the four figures row */}
      <div className="grid grid-cols-2 divide-line rounded-[12px] border border-line bg-white sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 px-4 py-3.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-12" />
          </div>
        ))}
      </div>

      {/* workload + team slots */}
      <Skeleton className="h-52 w-full rounded-[12px]" />
      <Skeleton className="h-64 w-full rounded-[12px]" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
