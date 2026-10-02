import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { IconDiamond } from "@tabler/icons-react";

import { Skeleton } from "~/components/skeleton";
import { api, type PlatinumInterest } from "~/lib/backend";
import { userErrorMessage } from "~/lib/errors";
import { InterestRow } from "./interest-row";

type Filter = "pending" | "approved" | "declined" | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "all", label: "All" },
];

/** The Platinum request queue, filtered by decision. */
export function InterestSection() {
  const [filter, setFilter] = useState<Filter>("pending");
  const requests = useQuery(
    api.platinum.listInterest,
    filter === "all" ? {} : { status: filter },
  ) as PlatinumInterest[] | undefined;
  const approve = useAction(api.platinum.approveInterest);
  const decline = useMutation(api.platinum.declineInterest);

  return (
    <section>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Requests
        </h2>
        <div className="flex items-center gap-1">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`h-7 rounded-lg px-2.5 text-[12.5px] font-medium transition ${
                filter === value
                  ? "bg-black/[0.07] text-neutral-900 dark:bg-white/[0.09] dark:text-neutral-100"
                  : "text-neutral-500 hover:bg-black/[0.04] hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/[0.05] dark:hover:text-neutral-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {requests === undefined ? (
          <QueueSkeleton />
        ) : requests.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <ul className="flex flex-col gap-2">
            {requests.map((request) => (
              <InterestRow
                key={request.id}
                request={request}
                // A minted link whose email bounced still resolves: the
                // approval landed and the row surfaces the mail error from
                // the record itself, so only a real failure throws.
                onApprove={async () => {
                  await approve({ id: request.id }).catch((cause: unknown) => {
                    throw new Error(
                      userErrorMessage(cause, "Couldn't approve that request."),
                    );
                  });
                }}
                onDecline={async () => {
                  await decline({ id: request.id }).catch((cause: unknown) => {
                    throw new Error(
                      userErrorMessage(cause, "Couldn't decline that request."),
                    );
                  });
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function QueueSkeleton() {
  return (
    <ul className="flex flex-col gap-2">
      {Array.from({ length: 2 }).map((_, i) => (
        <li
          key={i}
          className="flex flex-col gap-2 rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/[0.06] dark:bg-[#1B1B1B]"
        >
          <Skeleton className="h-3.5 w-44" />
          <Skeleton className="h-2.5 w-64" />
          <Skeleton className="mt-2 h-8 w-32 rounded-lg" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-black/[0.06] bg-white px-6 py-14 text-center dark:border-white/[0.06] dark:bg-[#1B1B1B]">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/[0.05] text-neutral-700 dark:bg-white/[0.08] dark:text-neutral-200">
        <IconDiamond size={22} stroke={1.8} />
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {filter === "pending" ? "Nobody waiting" : "Nothing here"}
        </h3>
        <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          {filter === "pending"
            ? "Requests land here while Platinum is closed for purchase."
            : "No requests with this status yet."}
        </p>
      </div>
    </div>
  );
}
