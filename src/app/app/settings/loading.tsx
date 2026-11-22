import { SkeletonHeader, SkeletonCards } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading">
      <SkeletonHeader />
      <SkeletonCards />
    </div>
  );
}
