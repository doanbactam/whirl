import { useEffect, useState } from "react";

import { ANALYTICS_EVENTS, captureEvent } from "~/lib/posthog";

// Client-only display preference: whether to show per-response stats (output
// tokens + response time) under each assistant message. Mirrors the theme/units
// preference pattern — localStorage plus a window event so every open settings
// surface and message row stays in sync without a round-trip.

const STORAGE_KEY = "show-stats";
const EVENT = "show-stats-change";

export function setShowStatsPref(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {}
  window.dispatchEvent(new CustomEvent<boolean>(EVENT, { detail: value }));
  captureEvent(ANALYTICS_EVENTS.statsToggled, { enabled: value });
}

export function readShowStatsPref(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Live preference with updates from settings. */
export function useShowStatsPref(): boolean {
  const [show, setShow] = useState<boolean>(() =>
    typeof window === "undefined" ? false : readShowStatsPref(),
  );

  useEffect(() => {
    const onChange = (event: Event) => {
      setShow((event as CustomEvent<boolean>).detail);
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  return show;
}
