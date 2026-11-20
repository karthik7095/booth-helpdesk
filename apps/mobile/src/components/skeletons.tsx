import { Box } from "@/components/ui/box";
import { HStack } from "@/components/ui/hstack";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { VStack } from "@/components/ui/vstack";

/** Placeholder rows shaped like the search results, so the list doesn't jump. */
export function VoterListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <VStack space="md" className="p-4">
      {Array.from({ length: rows }).map((_, index) => (
        <HStack key={index} className="overflow-hidden rounded-xl border border-border bg-card">
          <Box className="w-1.5 bg-secondary" />
          <HStack className="flex-1 items-center gap-3 p-3">
            <VStack space="xs" className="w-16">
              <Skeleton className="h-4 w-8 rounded" />
              <Skeleton className="h-3 w-10 rounded" />
            </VStack>
            <VStack space="xs" className="flex-1">
              <Skeleton className="h-4 w-3/4 rounded" />
              <Skeleton className="h-3 w-1/2 rounded" />
            </VStack>
            <VStack space="xs" className="items-end">
              <Skeleton className="h-4 w-12 rounded" />
              <Skeleton className="h-3 w-14 rounded" />
            </VStack>
          </HStack>
        </HStack>
      ))}
    </VStack>
  );
}

/** Matches the voter detail layout: two coloured cards then the editable fields. */
export function VoterDetailSkeleton() {
  return (
    <VStack space="xl" className="p-5">
      <VStack space="sm">
        <Skeleton className="h-4 w-24 rounded" />
        <Skeleton className="h-44 w-full rounded-2xl" />
      </VStack>
      <VStack space="sm">
        <Skeleton className="h-4 w-24 rounded" />
        <Skeleton className="h-52 w-full rounded-2xl" />
      </VStack>
      <VStack space="sm">
        <Skeleton className="h-4 w-32 rounded" />
        <SkeletonText _lines={3} className="h-3" />
      </VStack>
    </VStack>
  );
}

/** The home screen's constituency card and tiles. */
export function HomeSkeleton() {
  return (
    <VStack space="lg" className="p-5">
      <HStack className="items-center justify-between">
        <Skeleton className="h-12 w-12 rounded-full" />
        <HStack space="lg">
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-7 w-7 rounded" />
        </HStack>
      </HStack>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <HStack space="md">
        <Skeleton className="h-44 flex-1 rounded-2xl" />
        <Skeleton className="h-44 flex-1 rounded-2xl" />
      </HStack>
    </VStack>
  );
}
