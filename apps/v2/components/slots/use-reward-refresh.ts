"use client";

import { useEffect, useRef } from "react";
import type { Doc } from "@whirl/backend/convex/_generated/dataModel";

/** Compare receipt identities/statuses: a capped count stops changing at 100. */
export function useRewardRefresh(
  prizes: Doc<"slotPrizes">[] | undefined,
  refetch: () => Promise<unknown>,
) {
  const state = prizes
    ?.map((prize) => `${prize._id}:${prize.status}`)
    .join("|");
  const previous = useRef<string | undefined>(undefined);
  const refresh = useRef(refetch);
  useEffect(() => {
    refresh.current = refetch;
  }, [refetch]);
  useEffect(() => {
    if (
      state !== undefined &&
      previous.current !== undefined &&
      state !== previous.current
    ) {
      void refresh.current().catch(() => {});
    }
    previous.current = state;
  }, [state]);
}
