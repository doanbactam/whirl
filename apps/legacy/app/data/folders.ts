import { makeFunctionReference } from "convex/server";
import { useConvexAuth, useMutation } from "convex/react";

import { useQueryWithError } from "~/data/threads";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

export type Folder = {
  id: string;
  name: string;
  order: number;
  createdAt: number;
  updatedAt: number;
};

const EMPTY: Folder[] = [];
const listFolders = makeFunctionReference<"query">("folders:listForCurrentUser");
const listThreads = makeFunctionReference<"query">("threads:listForCurrentUser");
const createFolderRef = makeFunctionReference<"mutation">("folders:createFolder");
const renameFolderRef = makeFunctionReference<"mutation">("folders:renameFolder");
const deleteFolderRef = makeFunctionReference<"mutation">("folders:deleteFolder");
const reorderFoldersRef = makeFunctionReference<"mutation">(
  "folders:reorderFolders",
);

export function useFolders(): Folder[] {
  const { isAuthenticated } = useConvexAuth();
  const { data: folders } = useQueryWithError<Folder[]>(
    listFolders,
    isAuthenticated ? {} : "skip",
  );
  return folders ?? EMPTY;
}

export function useFolderActions() {
  const capture = useCapture();

  const createFolder = useMutation(createFolderRef);

  const renameFolder = useMutation(renameFolderRef).withOptimisticUpdate(
    (store, args) => {
      const a = args as { folderId: string; name: string };
      const existing = store.getQuery(listFolders, {}) as Folder[] | undefined;
      if (!existing) return;
      store.setQuery(
        listFolders,
        {},
        existing.map((f) =>
          f.id === a.folderId
            ? { ...f, name: a.name, updatedAt: Date.now() }
            : f,
        ),
      );
    },
  );

  const deleteFolder = useMutation(deleteFolderRef).withOptimisticUpdate(
    (store, args) => {
      const a = args as { folderId: string };
      const folders = store.getQuery(listFolders, {}) as Folder[] | undefined;
      if (folders) {
        store.setQuery(
          listFolders,
          {},
          folders.filter((f) => f.id !== a.folderId),
        );
      }
      // Release the folder's threads back into the date groups right away so
      // they don't blink out of the sidebar while the mutation lands.
      const threads = store.getQuery(listThreads, {}) as
        | Array<{ folderId: string | null }>
        | undefined;
      if (threads) {
        store.setQuery(
          listThreads,
          {},
          threads.map((t) =>
            t.folderId === a.folderId ? { ...t, folderId: null } : t,
          ),
        );
      }
    },
  );

  const reorderFolders = useMutation(reorderFoldersRef).withOptimisticUpdate(
    (store, args) => {
      const a = args as { folderIds: string[] };
      const existing = store.getQuery(listFolders, {}) as Folder[] | undefined;
      if (!existing) return;
      const position = new Map(a.folderIds.map((id, index) => [id, index]));
      store.setQuery(
        listFolders,
        {},
        existing
          .map((f) => ({ ...f, order: position.get(f.id) ?? f.order }))
          .sort((x, y) => x.order - y.order || x.createdAt - y.createdAt),
      );
    },
  );

  return {
    async createFolder(name: string): Promise<string | null> {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const folderId = (await createFolder({ name: trimmed })) as string;
      capture(ANALYTICS_EVENTS.folderCreated, {
        folder_id: folderId,
        name_length: trimmed.length,
      });
      return folderId;
    },
    async renameFolder(folderId: string, name: string) {
      const trimmed = name.trim();
      if (!trimmed) return;
      await renameFolder({ folderId, name: trimmed });
      capture(ANALYTICS_EVENTS.folderRenamed, { folder_id: folderId });
    },
    async deleteFolder(folderId: string) {
      await deleteFolder({ folderId });
      capture(ANALYTICS_EVENTS.folderDeleted, { folder_id: folderId });
    },
    async reorderFolders(folderIds: string[]) {
      await reorderFolders({ folderIds });
      capture(ANALYTICS_EVENTS.foldersReordered, { count: folderIds.length });
    },
  };
}
