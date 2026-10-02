import { useSyncExternalStore } from "react";

import type { SettingsSection } from "~/components/settings-modal";

// Global controller for the in-app settings modal, so anything (gate banners,
// the upgrade modal, menus) can open it — optionally on a specific tab —
// without threading state through the tree.

type SettingsState = { open: boolean; section?: SettingsSection };

let state: SettingsState = { open: false };
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function openSettings(section?: SettingsSection) {
  state = { open: true, section };
  notify();
}

export function closeSettings() {
  if (!state.open) return;
  state = { open: false };
  notify();
}

export function useSettingsState(): SettingsState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}
