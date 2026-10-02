import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";

import { fetchKirkifyQuota } from "./client";
import type { KirkifyQuota, KirkifyRemaining } from "./types";

/**
 * What the visitor has left today. Read once auth has settled, again
 * whenever the session changes (the sign-in modal closing is the case that
 * matters), and again when the tab comes back into view, so a page left
 * open past midnight UTC doesn't keep showing yesterday's number.
 */
export function useKirkifyQuota() {
  const { isLoaded, isSignedIn } = useAuth();
  const [quota, setQuota] = useState<KirkifyQuota | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    fetchKirkifyQuota().then(
      (next) => {
        if (!cancelled) setQuota(next);
      },
      () => {
        /* The counter is a courtesy; the server still says no on its own. */
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    return load();
  }, [isLoaded, isSignedIn, load]);

  useEffect(() => {
    let cancel: (() => void) | null = null;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      cancel?.();
      cancel = load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancel?.();
    };
  }, [load]);

  /** The server's count after a swap, taken as the new truth. */
  const apply = useCallback((remaining: KirkifyRemaining) => {
    setQuota((current) => (current ? { ...current, remaining } : current));
  }, []);

  return { quota, apply };
}
