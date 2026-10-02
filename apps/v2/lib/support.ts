"use client";

import { useSyncExternalStore } from "react";

/* Whether the Median support panel is on the page, and whether it is open.
   A module-level store, same shape as lib/toasts.ts and lib/incognito.ts.

   Two flags rather than one because they answer different questions. The
   widget has no launcher of its own here (that is deliberate: the corner
   bubble is not a thing this app wants), so nothing would ever mount it,
   which means `mounted` latches on the first request and never goes back —
   closing the panel keeps the conversation alive for the rest of the visit.
   `open` is the one that flips.

   Everything the widget needs, its chunk, its stylesheet, and a signed
   identity, is fetched on that first request rather than on load, so a
   session that never asks for support never pays for it. */

export type SupportState = {
  mounted: boolean;
  open: boolean;
};

const CLOSED: SupportState = { mounted: false, open: false };

let state: SupportState = CLOSED;
const listeners = new Set<() => void>();

function set(next: SupportState) {
  if (next.mounted === state.mounted && next.open === state.open) return;
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSupportState(): SupportState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => CLOSED,
  );
}

/* Whether this deployment has a support agent at all. The support widget is
   optional (it needs MEDIAN_KEY on the server), so the root layout reads the
   env, SupportMount reports it here, and the user menu leaves its Support
   row out when there's no one on the other end. */
let available = false;

export function setSupportAvailable(next: boolean) {
  if (next === available) return;
  available = next;
  for (const listener of listeners) listener();
}

export function useSupportAvailable(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => available,
    () => false,
  );
}

export function openSupport() {
  if (!available) return;
  set({ mounted: true, open: true });
}

/** The widget's own close, and ours. Mounted stays true on purpose. */
export function setSupportOpen(open: boolean) {
  set({ mounted: state.mounted || open, open });
}

/* Signing out has to take the conversation with it: the thread belongs to the
   browser, not the account, so the next person at a shared machine would
   otherwise be able to read it. The widget's reset() is imported lazily,
   because the common case is signing out having never opened support at all,
   and pulling the chunk in for that would undo the whole point of the gate. */
export async function resetSupport() {
  const wasMounted = state.mounted;
  set(CLOSED);
  if (!wasMounted) return;

  try {
    const { medianSupport } = await import("@mediansh/widget");
    medianSupport.reset();
  } catch (error) {
    console.error("Couldn't reset the support conversation", error);
  }
}
