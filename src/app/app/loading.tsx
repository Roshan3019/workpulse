import { Skeleton, SkeletonHeader, SkeletonCards } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading dashboard">
      <SkeletonHeader action={false} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <SkeletonCards rows={2} className="h-40" />
    </div>
  );
}
