import { useEffect, useState } from "react";

import { ANALYTICS_EVENTS, captureEvent } from "~/lib/posthog";

// Client-only chat preference: whether the conversation follows new messages
// as they stream in. Off means the viewport stays put and the scroll-to-bottom
// button does the chauffeuring instead. Mirrors the show-stats pattern —
// localStorage plus a window event so the settings toggle and the chat stay
// in sync without a round-trip.

const STORAGE_KEY = "chat-auto-scroll";
const EVENT = "chat-auto-scroll-change";

export function setAutoScrollPref(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {}
  window.dispatchEvent(new CustomEvent<boolean>(EVENT, { detail: value }));
  captureEvent(ANALYTICS_EVENTS.autoScrollToggled, { enabled: value });
}

/** Defaults to true — following the conversation is the expected behavior. */
export function readAutoScrollPref(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Live preference with updates from settings. */
export function useAutoScrollPref(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() =>
    typeof window === "undefined" ? true : readAutoScrollPref(),
  );

  useEffect(() => {
    const onChange = (event: Event) => {
      setEnabled((event as CustomEvent<boolean>).detail);
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  return enabled;
}
