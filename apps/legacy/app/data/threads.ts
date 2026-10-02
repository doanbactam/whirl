import type { FunctionReference } from "convex/server";
import { makeFunctionReference } from "convex/server";
import {
  useAction,
  useConvexAuth,
  useMutation,
  useQuery_experimental,
} from "convex/react";

import { requestDelete, usePendingDeleteIds } from "~/data/toasts";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

type QueryStatus = "pending" | "success" | "error";
type QueryWithErrorResult<T> = {
  data: T | undefined;
  error: Error | undefined;
  status: QueryStatus;
};

// Convex exposes an object-form `useQuery_experimental` with `throwOnError:
// false` that surfaces errors instead of throwing into the React tree, but the
// published types are loose. Wrap it once with a precise signature. (Also used
// by ~/data/folders.)
export function useQueryWithError<T>(
  query: FunctionReference<"query">,
  args: Record<string, unknown> | "skip",
): QueryWithErrorResult<T> {
  return (
    useQuery_experimental as unknown as (input: {
      query: FunctionReference<"query">;
      args: Record<string, unknown> | "skip";
      throwOnError: boolean;
    }) => QueryWithErrorResult<T>
  )({ query, args, throwOnError: false });
}

export type ThreadTitleStatus = "generating" | "ready";

export type CompactionStatus = "idle" | "compacting" | "ready";

export type CompactionMarker = { messageId: string; createdAt: number };

export type ModelKey = "Auto" | "Fast" | "Basic" | "Max" | "Image";

export type Thread = {
  id: string;
  title: string;
  titleStatus: ThreadTitleStatus;
  /** True while this thread's latest assistant turn is still generating. */
  running: boolean;
  group: string;
  createdAt: number;
  updatedAt: number;
  pinnedAt: number | null;
  model: ModelKey | null;
  compactionStatus: CompactionStatus;
  compactionBoundary: string | null;
  compactionUpdatedAt: number | null;
  compactionMarkers: CompactionMarker[];
  /** Public share token when the thread is shared; null until the user shares. */
  shareId: string | null;
  /** Sidebar folder this thread lives in; null when unfiled. */
  folderId: string | null;
  /** Thread this one was branched off of; null for ordinary threads. */
  branchedFromThreadId: string | null;
};

type StoredThread = Omit<Thread, "group">;

const EMPTY: Thread[] = [];
const PINNED_GROUP = "Pinned";
const listThreads = makeFunctionReference<"query">("threads:listForCurrentUser");
const updateThreadRef = makeFunctionReference<"mutation">("threads:updateThread");
const deleteThreadRef = makeFunctionReference<"mutation">("threads:deleteThread");
const setPinnedRef = makeFunctionReference<"mutation">("threads:setPinned");
const setFolderRef = makeFunctionReference<"mutation">("threads:setFolder");
const setModelRef = makeFunctionReference<"mutation">("threads:setModel");
const shareThreadRef = makeFunctionReference<"mutation">("threads:shareThread");
const unshareThreadRef = makeFunctionReference<"mutation">("threads:unshareThread");
const compactThreadRef = makeFunctionReference<"action">("compaction:compactThread");

function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatThreadGroup(updatedAt: number) {
  const now = new Date();
  const updated = new Date(updatedAt);
  const todayStart = startOfDay(now).getTime();
  const updatedStart = startOfDay(updated).getTime();
  const dayDiff = Math.round((todayStart - updatedStart) / 86_400_000);

  if (dayDiff <= 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff <= 7) return "Previous 7 days";
  if (dayDiff <= 30) return "Previous 30 days";
  return "Older";
}

export function useThreads(): Thread[] {
  const { isAuthenticated } = useConvexAuth();
  const { data: threads } = useQueryWithError<StoredThread[]>(
    listThreads,
    isAuthenticated ? {} : "skip",
  );
  const hidden = usePendingDeleteIds();

  if (!threads) {
    return EMPTY;
  }

  const visible = threads
    .filter((thread) => !hidden.has(thread.id))
    .map((thread) => ({
      ...thread,
      group: thread.pinnedAt ? PINNED_GROUP : formatThreadGroup(thread.updatedAt),
    }));

  return visible.sort((a, b) => {
    if (a.pinnedAt && b.pinnedAt) return b.pinnedAt - a.pinnedAt;
    if (a.pinnedAt) return -1;
    if (b.pinnedAt) return 1;
    return b.updatedAt - a.updatedAt;
  });
}

export function useThreadsLoading(): boolean {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { status } = useQueryWithError<StoredThread[]>(
    listThreads,
    isAuthenticated ? {} : "skip",
  );
  if (authLoading) return true;
  if (!isAuthenticated) return false;
  return status === "pending";
}

export function useThreadsError(): Error | null {
  const { isAuthenticated } = useConvexAuth();
  const { error } = useQueryWithError<StoredThread[]>(
    listThreads,
    isAuthenticated ? {} : "skip",
  );
  return error ?? null;
}

export function useThreadActions() {
  const capture = useCapture();
  const renameThread = useMutation(updateThreadRef).withOptimisticUpdate(
    (store, args) => {
      const a = args as { threadId: string; title: string };
      const existing = store.getQuery(listThreads, {}) as
        | StoredThread[]
        | undefined;
      if (!existing) return;
      const now = Date.now();
      store.setQuery(
        listThreads,
        {},
        existing.map((t) =>
          t.id === a.threadId
            ? { ...t, title: a.title, titleStatus: "ready", updatedAt: now }
            : t,
        ),
      );
    },
  );

  const deleteThread = useMutation(deleteThreadRef).withOptimisticUpdate(
    (store, args) => {
      const a = args as { threadId: string };
      const existing = store.getQuery(listThreads, {}) as
        | StoredThread[]
        | undefined;
      if (!existing) return;
      store.setQuery(
        listThreads,
        {},
        existing.filter((t) => t.id !== a.threadId),
      );
    },
  );

  const setPinned = useMutation(setPinnedRef).withOptimisticUpdate(
    (store, args) => {
      const a = args as { threadId: string; pinned: boolean };
      const existing = store.getQuery(listThreads, {}) as
        | StoredThread[]
        | undefined;
      if (!existing) return;
      store.setQuery(
        listThreads,
        {},
        existing.map((t) =>
          t.id === a.threadId
            ? { ...t, pinnedAt: a.pinned ? Date.now() : null }
            : t,
        ),
      );
    },
  );

  const setFolder = useMutation(setFolderRef).withOptimisticUpdate(
    (store, args) => {
      const a = args as { threadId: string; folderId: string | null };
      const existing = store.getQuery(listThreads, {}) as
        | StoredThread[]
        | undefined;
      if (!existing) return;
      store.setQuery(
        listThreads,
        {},
        existing.map((t) =>
          t.id === a.threadId ? { ...t, folderId: a.folderId } : t,
        ),
      );
    },
  );

  const compactThreadAction = useAction(compactThreadRef);

  const shareThread = useMutation(shareThreadRef);

  const unshareThread = useMutation(unshareThreadRef).withOptimisticUpdate(
    (store, args) => {
      const a = args as { threadId: string };
      const existing = store.getQuery(listThreads, {}) as
        | StoredThread[]
        | undefined;
      if (!existing) return;
      store.setQuery(
        listThreads,
        {},
        existing.map((t) =>
          t.id === a.threadId ? { ...t, shareId: null } : t,
        ),
      );
    },
  );

  const setModel = useMutation(setModelRef).withOptimisticUpdate(
    (store, args) => {
      const a = args as { threadId: string; model: ModelKey };
      const existing = store.getQuery(listThreads, {}) as
        | StoredThread[]
        | undefined;
      if (!existing) return;
      store.setQuery(
        listThreads,
        {},
        existing.map((t) =>
          t.id === a.threadId ? { ...t, model: a.model } : t,
        ),
      );
    },
  );

  return {
    async renameThread(threadId: string, title: string) {
      const trimmed = title.trim();
      if (!trimmed) return;
      await renameThread({ threadId, title: trimmed });
      capture(ANALYTICS_EVENTS.threadRenamed, {
        thread_id: threadId,
        title_length: trimmed.length,
      });
    },
    deleteThread(threadId: string, title: string) {
      const label = title.trim() || "thread";
      capture(ANALYTICS_EVENTS.threadDeleted, { thread_id: threadId });
      requestDelete({
        threadId,
        message: `Deleted "${label}"`,
        commit: () => {
          void deleteThread({ threadId }).catch(() => {});
        },
      });
    },
    async setFolder(
      threadId: string,
      folderId: string | null,
      source: "menu" | "drag" = "menu",
    ) {
      await setFolder({ threadId, folderId });
      capture(ANALYTICS_EVENTS.threadFolderChanged, {
        thread_id: threadId,
        folder_id: folderId,
        source,
      });
    },
    async setPinned(threadId: string, pinned: boolean) {
      await setPinned({ threadId, pinned });
      capture(ANALYTICS_EVENTS.threadPinToggled, {
        thread_id: threadId,
        pinned,
      });
    },
    async setModel(threadId: string, model: ModelKey) {
      await setModel({ threadId, model });
      capture(ANALYTICS_EVENTS.threadModelChanged, {
        thread_id: threadId,
        model,
      });
    },
    async compactThread(threadId: string) {
      await compactThreadAction({ threadId });
      capture(ANALYTICS_EVENTS.threadCompacted, { thread_id: threadId });
    },
    async shareThread(threadId: string) {
      const { shareId } = (await shareThread({ threadId })) as {
        shareId: string;
      };
      capture(ANALYTICS_EVENTS.threadShared, { thread_id: threadId });
      return shareId;
    },
    async unshareThread(threadId: string) {
      await unshareThread({ threadId });
      capture(ANALYTICS_EVENTS.threadShareRevoked, { thread_id: threadId });
    },
  };
}

/**
 * Splits threads into folder members (keyed by folder id) and the loose rest.
 * A thread pointing at an id not in `folderIds` (e.g. its folder was just
 * deleted elsewhere) counts as loose so it never vanishes from the sidebar.
 */
export function partitionThreadsByFolder(
  items: Thread[],
  folderIds: Set<string>,
): { byFolder: Map<string, Thread[]>; loose: Thread[] } {
  const byFolder = new Map<string, Thread[]>();
  const loose: Thread[] = [];
  for (const thread of items) {
    if (thread.folderId && folderIds.has(thread.folderId)) {
      const members = byFolder.get(thread.folderId);
      if (members) members.push(thread);
      else byFolder.set(thread.folderId, [thread]);
    } else {
      loose.push(thread);
    }
  }
  return { byFolder, loose };
}

export function groupThreads(items: Thread[]): [string, Thread[]][] {
  return items.reduce<[string, Thread[]][]>((acc, thread) => {
    const last = acc[acc.length - 1];
    if (last && last[0] === thread.group) {
      last[1].push(thread);
      return acc;
    }

    acc.push([thread.group, [thread]]);
    return acc;
  }, []);
}
