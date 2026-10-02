import { useSyncExternalStore } from "react";

import { ANALYTICS_EVENTS, captureEvent } from "~/lib/posthog";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastTone = "danger" | "info" | "success" | "neutral";

export type Toast = {
  id: string;
  message: string;
  action?: ToastAction;
  durationMs: number;
  createdAt: number;
  tone?: ToastTone;
};

type PendingDelete = {
  toastId: string;
  timeoutId: ReturnType<typeof setTimeout>;
  commit: () => void;
};

let toasts: readonly Toast[] = Object.freeze([]);
let pendingDeleteIds: ReadonlySet<string> = new Set();
const pendingDeletes = new Map<string, PendingDelete>();
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify() {
  for (const fn of listeners) fn();
}

function rebuildPendingSnapshot() {
  pendingDeleteIds = new Set(pendingDeletes.keys());
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function removeToast(id: string) {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = Object.freeze(next);
  notify();
}

export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(
    subscribe,
    () => toasts,
    () => toasts,
  );
}

export function usePendingDeleteIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => pendingDeleteIds,
    () => pendingDeleteIds,
  );
}

export function dismissToast(id: string) {
  removeToast(id);
}

export function showToast(args: {
  message: string;
  durationMs?: number;
  action?: ToastAction;
  tone?: ToastTone;
}) {
  const toast: Toast = {
    id: makeId(),
    message: args.message,
    durationMs: args.durationMs ?? 5000,
    createdAt: Date.now(),
    ...(args.tone ? { tone: args.tone } : {}),
    ...(args.action ? { action: args.action } : {}),
  };
  toasts = Object.freeze([...toasts, toast]);
  notify();
  window.setTimeout(() => removeToast(toast.id), toast.durationMs);
}

export const UPDATE_TOAST_ID = "app-update";

// A persistent, non-dismissing toast prompting the user to reload onto the
// latest deployment. De-duplicated so repeated checks never stack it.
export function showUpdateToast(onRefresh: () => void) {
  if (toasts.some((t) => t.id === UPDATE_TOAST_ID)) return;
  const toast: Toast = {
    id: UPDATE_TOAST_ID,
    message: "A new version is available",
    durationMs: 0,
    createdAt: Date.now(),
    tone: "info",
    action: { label: "Refresh", onClick: onRefresh },
  };
  toasts = Object.freeze([...toasts, toast]);
  notify();
}

export function requestDelete(args: {
  threadId: string;
  message: string;
  durationMs?: number;
  commit: () => void;
}) {
  const { threadId, message, commit } = args;
  const durationMs = args.durationMs ?? 5000;

  const existing = pendingDeletes.get(threadId);
  if (existing) {
    clearTimeout(existing.timeoutId);
    removeToast(existing.toastId);
    pendingDeletes.delete(threadId);
  }

  const toastId = makeId();
  const timeoutId = setTimeout(() => {
    const entry = pendingDeletes.get(threadId);
    if (!entry || entry.toastId !== toastId) return;
    pendingDeletes.delete(threadId);
    rebuildPendingSnapshot();
    removeToast(toastId);
    entry.commit();
  }, durationMs);

  pendingDeletes.set(threadId, { toastId, timeoutId, commit });
  rebuildPendingSnapshot();

  const toast: Toast = {
    id: toastId,
    message,
    durationMs,
    createdAt: Date.now(),
    action: {
      label: "Undo",
      onClick: () => undoDelete(threadId),
    },
  };
  toasts = Object.freeze([...toasts, toast]);
  notify();
}

export function undoDelete(threadId: string) {
  const entry = pendingDeletes.get(threadId);
  if (!entry) return;
  captureEvent(ANALYTICS_EVENTS.threadDeleteUndone, { thread_id: threadId });
  clearTimeout(entry.timeoutId);
  pendingDeletes.delete(threadId);
  rebuildPendingSnapshot();
  removeToast(entry.toastId);
}
