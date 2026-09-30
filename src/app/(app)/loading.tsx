import { SkeletonRows } from "@/components/primitives";

export default function Loading() {
  return (
    <div role="status" aria-label="화면 불러오는 중" className="space-y-4">
      <div aria-hidden="true" className="h-7 w-28 animate-pulse rounded-md bg-app-gray-200" />
      <SkeletonRows rows={3} />
    </div>
  );
}
