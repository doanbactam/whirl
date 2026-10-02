import { Skeleton } from "~/components/skeleton";

// Loading placeholders for the settings panes that wait on Autumn (the customer
// record) or Clerk (the user). They trace the real layout closely so the swap
// to live content doesn't jump around.

function RowSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-black/[0.04] py-3.5 last:border-b-0 dark:border-white/[0.05]">
      <div className="flex min-w-0 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-24" />
        {wide && <Skeleton className="h-3 w-44" />}
      </div>
      <Skeleton className="h-9 w-28 rounded-lg" />
    </div>
  );
}

export function UsagePaneSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-4 pb-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-28" />
        </div>
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>

      <div className="rounded-xl border border-black/[0.06] bg-black/[0.015] p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <div className="mb-2.5 flex items-baseline justify-between">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </div>

      <Skeleton className="mt-5 h-3 w-28" />
      <Skeleton className="mt-3 h-24 w-full rounded-xl" />
    </div>
  );
}

export function BillingPaneSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-4 pb-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-1 h-3 w-52" />
        </div>
      </div>
      <div className="border-t border-black/[0.06] dark:border-white/[0.06]">
        <RowSkeleton wide />
        <RowSkeleton wide />
      </div>
    </div>
  );
}

export function ExtraUsagePaneSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-4 pb-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-10 w-10 rounded-full" />
      </div>
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="mt-5 h-3 w-28" />
      <Skeleton className="mt-3 h-24 w-full rounded-xl" />
    </div>
  );
}

export function AccountPaneSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-black/[0.04] py-3.5 dark:border-white/[0.05]">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-9 w-20 rounded-lg" />
        </div>
      </div>
      <RowSkeleton />
      <RowSkeleton />
      <RowSkeleton />
      <RowSkeleton wide />
    </div>
  );
}
