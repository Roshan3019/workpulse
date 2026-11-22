import type { ReactNode } from "react";

/**
 * Calm grey bones used while a route is fetching.
 *
 * A skeleton does not make the server faster — it makes the wait legible.
 * Instead of the browser sitting on the previous page with no feedback (which
 * reads as "this site is slow / did my click register?"), the new page's shape
 * appears immediately and fills in. `animate-pulse` is disabled for people who
 * ask for reduced motion.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-[#e8eaf3] motion-reduce:animate-none ${className}`}
      aria-hidden="true"
    />
  );
}

/** Page header: title, one-line description, optional action button on the right. */
export function SkeletonHeader({ action = true }: { action?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-3.5 w-64" />
      </div>
      {action && <Skeleton className="h-10 w-32 rounded-xl" />}
    </div>
  );
}

/** A stack of card-shaped blocks. */
export function SkeletonCards({ rows = 3, className = "h-32" }: { rows?: number; className?: string }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={`w-full ${className}`} />
      ))}
    </div>
  );
}

/**
 * Standard route-level shell: the same page width and spacing as the real
 * pages, so nothing shifts when the content arrives.
 */
export function PageSkeleton({ children }: { children?: ReactNode }) {
  return (
    <div className="space-y-5" role="status" aria-label="Loading">
      <SkeletonHeader />
      {children ?? <SkeletonCards />}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
