import { ANALYTICS_EVENTS, captureEvent } from "~/lib/posthog";

// Client-only composer preference: whether the "That's a big paste" dialog
// asks if a long paste should become a .md attachment. Off means big pastes
// drop straight into the composer as plain text, no questions asked. Mirrors
// the show-stats pattern — localStorage plus a window event so the settings
// toggle and the paste modal's "don't ask again" tickbox stay in sync.

const STORAGE_KEY = "ask-before-big-paste";
const EVENT = "ask-before-big-paste-change";

export function setAskBeforeBigPastePref(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {}
  window.dispatchEvent(new CustomEvent<boolean>(EVENT, { detail: value }));
  captureEvent(ANALYTICS_EVENTS.pastePromptToggled, { enabled: value });
}

/** Defaults to true — we only go quiet once someone asks us to. */
export function readAskBeforeBigPastePref(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function subscribeAskBeforeBigPastePref(
  onChange: (value: boolean) => void,
): () => void {
  const handler = (event: Event) => {
    onChange((event as CustomEvent<boolean>).detail);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
