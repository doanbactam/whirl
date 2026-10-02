"use client";

import { useEffect } from "react";

/* Registers public/sw.js — the offline page and the shell asset cache.
 *
 * Production only, and it actively tears the worker down everywhere else.
 * A worker registered against localhost outlives the build that installed
 * it: it keeps answering after the next `next dev` starts, and the first
 * thing anyone blames for a stale page is the code they just wrote. So dev
 * doesn't just skip registering — it unregisters whatever is already there,
 * including one left behind by a production build served from this port. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((one) => one.unregister())),
        )
        .catch(() => {
          // Nothing registered, or the browser said no. Either is fine here.
        });
      return;
    }

    /* After load, not during it: registration competes with the chunks and
       the first Convex round trip for the same connection, and nothing on
       screen is waiting on it. */
    let cancelled = false;
    const register = () => {
      if (cancelled) return;
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        /* Nothing on screen breaks without it — the app is online-first and
           the worker only ever adds a fallback. Worth a line in the console
           so a missing offline page is explainable rather than mysterious. */
        console.warn("Whirl: offline support is unavailable —", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return () => {
        cancelled = true;
      };
    }
    window.addEventListener("load", register, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
