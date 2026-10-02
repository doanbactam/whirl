import { useMemo } from "react";
import type { OptimisticLocalStore } from "convex/browser";
import { useConvexAuth, useMutation, useQuery } from "convex/react";

import { api, WHIRL_ORIGIN, type ThreadId } from "@/lib/convex";

/**
 * One thread as the sidebar query hands it over.
 *
 * `convex/threads.ts` returns a few more fields (compaction state, model), but
 * a list row has no use for them — this is the subset the app reads, not the
 * whole document.
 */
export type ThreadSummary = {
  id: ThreadId;
  title: string;
  titleStatus: "ready" | "generating" | string;
  /** True while the thread's latest assistant turn is still in flight. */
  running: boolean;
  createdAt: number;
  updatedAt: number;
  pinnedAt: number | null;
  shareId: string | null;
  folderId: string | null;
  branchedFromThreadId: string | null;
};

export const PINNED_GROUP = "Pinned";

function startOfDay(value: number) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Same buckets, in the same words, as the web app's sidebar. */
export function formatThreadGroup(updatedAt: number): string {
  const dayDiff = Math.round(
    (startOfDay(Date.now()) - startOfDay(updatedAt)) / 86_400_000,
  );
  if (dayDiff <= 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff <= 7) return "Previous 7 days";
  if (dayDiff <= 30) return "Previous 30 days";
  return "Older";
}

/** Pinned first (freshest pin wins), then by last activity. */
function compareThreads(a: ThreadSummary, b: ThreadSummary) {
  if (a.pinnedAt !== null && b.pinnedAt !== null) return b.pinnedAt - a.pinnedAt;
  if (a.pinnedAt !== null) return -1;
  if (b.pinnedAt !== null) return 1;
  return b.updatedAt - a.updatedAt;
}

export type ThreadSection = { title: string; data: ThreadSummary[] };

/** Collapses the sorted list into contiguous runs, ready for a SectionList. */
export function sectionThreads(threads: ThreadSummary[]): ThreadSection[] {
  const sections: ThreadSection[] = [];
  for (const thread of threads) {
    const title =
      thread.pinnedAt !== null
        ? PINNED_GROUP
        : formatThreadGroup(thread.updatedAt);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.data.push(thread);
    else sections.push({ title, data: [thread] });
  }
  return sections;
}

/**
 * Every thread the signed-in user has, newest first, or `undefined` while the
 * first page is still in the air.
 *
 * The query is skipped until Convex has the Clerk token — asking earlier just
 * earns a "Not authenticated" that resolves itself a moment later.
 */
export function useThreads(): ThreadSummary[] | undefined {
  const { isAuthenticated } = useConvexAuth();
  const threads = useQuery(
    api.threads.listForCurrentUser,
    isAuthenticated ? {} : "skip",
  );

  return useMemo(
    () => (threads ? [...threads].sort(compareThreads) : undefined),
    [threads],
  );
}

/** The public URL for a shared conversation. */
export function threadShareUrl(shareId: string): string {
  return `${WHIRL_ORIGIN}/share/${shareId}`;
}

function patchThread(
  store: OptimisticLocalStore,
  threadId: ThreadId,
  patch: Partial<ThreadSummary>,
) {
  const current = store.getQuery(api.threads.listForCurrentUser, {});
  if (!current) return;
  store.setQuery(
    api.threads.listForCurrentUser,
    {},
    current.map((thread) =>
      thread.id === threadId ? { ...thread, ...patch } : thread,
    ),
  );
}

/**
 * The actions a thread row offers.
 *
 * Each one is optimistic where it can be: a pin that waits for the round trip
 * before it moves is a pin that feels broken, and on a phone the round trip is
 * the slowest part of the whole interaction. The server is still the authority
 * — every optimistic patch is replaced by the real query result moments later,
 * and by the *old* one if the mutation fails.
 */
export function useThreadActions() {
  const rename = useMutation(api.threads.updateThread).withOptimisticUpdate(
    (store, args) => {
      patchThread(store, args.threadId, {
        title: args.title,
        titleStatus: "ready",
        updatedAt: Date.now(),
      });
    },
  );

  /* Optimistic so the shimmer starts on the tap rather than on the reply; the
     backend clears it whichever way the model goes. */
  const regenerateTitle = useMutation(
    api.threads.regenerateTitle,
  ).withOptimisticUpdate((store, args) => {
    patchThread(store, args.threadId, { titleStatus: "generating" });
  });

  const setPinned = useMutation(api.threads.setPinned).withOptimisticUpdate(
    (store, args) => {
      patchThread(store, args.threadId, {
        pinnedAt: args.pinned ? Date.now() : null,
      });
    },
  );

  const deleteThread = useMutation(
    api.threads.deleteThread,
  ).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.threads.listForCurrentUser, {});
    if (!current) return;
    store.setQuery(
      api.threads.listForCurrentUser,
      {},
      current.filter((thread) => thread.id !== args.threadId),
    );
  });

  /* Idempotent backend-side: re-sharing hands back the token it already
     minted, so there's never a second link to the same conversation. */
  const share = useMutation(api.threads.shareThread);

  const unshare = useMutation(api.threads.unshareThread).withOptimisticUpdate(
    (store, args) => {
      patchThread(store, args.threadId, { shareId: null });
    },
  );

  return useMemo(
    () => ({
      rename: (threadId: ThreadId, title: string) =>
        rename({ threadId, title }),
      regenerateTitle: (threadId: ThreadId) => regenerateTitle({ threadId }),
      setPinned: (threadId: ThreadId, pinned: boolean) =>
        setPinned({ threadId, pinned }),
      remove: (threadId: ThreadId) => deleteThread({ threadId }),
      share: async (threadId: ThreadId) => {
        const { shareId } = await share({ threadId });
        return threadShareUrl(shareId);
      },
      unshare: (threadId: ThreadId) => unshare({ threadId }),
    }),
    [rename, regenerateTitle, setPinned, deleteThread, share, unshare],
  );
}
