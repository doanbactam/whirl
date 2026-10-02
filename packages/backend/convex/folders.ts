import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/** Keep names tidy in the sidebar; anything longer truncates visually anyway. */
export const MAX_FOLDER_NAME_LENGTH = 80;
/** Sanity cap — nobody needs more, and it bounds the reorder mutation. */
export const MAX_FOLDERS_PER_USER = 50;

async function getCurrentUserId(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Not authenticated");
  }
  return identity.subject;
}

async function getOwnedFolder(ctx: MutationCtx, folderId: Id<"folders">) {
  const userId = await getCurrentUserId(ctx);
  const folder = await ctx.db.get(folderId);
  if (!folder || folder.userId !== userId) {
    throw new Error("Folder not found");
  }
  return { folder, userId };
}

function listUserFolders(ctx: QueryCtx | MutationCtx, userId: string) {
  return ctx.db
    .query("folders")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(MAX_FOLDERS_PER_USER);
}

function sortFolders(folders: Doc<"folders">[]) {
  return folders.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

/** The signed-in user's folders in their chosen order (lowest `order` first). */
export const listForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);
    const folders = await listUserFolders(ctx, userId);
    return sortFolders(folders).map((folder) => ({
      id: folder._id,
      name: folder.name,
      order: folder.order,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    }));
  },
});

/** Creates a folder at the end of the list and returns its id. */
export const createFolder = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await getCurrentUserId(ctx);
    const trimmed = name.trim().slice(0, MAX_FOLDER_NAME_LENGTH);
    if (!trimmed) {
      throw new Error("Folder name cannot be empty");
    }

    const existing = await listUserFolders(ctx, userId);
    if (existing.length >= MAX_FOLDERS_PER_USER) {
      throw new Error("Folder limit reached");
    }

    const now = Date.now();
    const maxOrder = existing.reduce(
      (max, folder) => Math.max(max, folder.order),
      -1,
    );
    return await ctx.db.insert("folders", {
      userId,
      name: trimmed,
      order: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const renameFolder = mutation({
  args: { folderId: v.id("folders"), name: v.string() },
  handler: async (ctx, { folderId, name }) => {
    await getOwnedFolder(ctx, folderId);
    const trimmed = name.trim().slice(0, MAX_FOLDER_NAME_LENGTH);
    if (!trimmed) {
      throw new Error("Folder name cannot be empty");
    }
    await ctx.db.patch(folderId, { name: trimmed, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Deletes a folder and releases its threads back into the regular date groups.
 * The threads themselves are never touched beyond clearing `folderId`.
 */
export const deleteFolder = mutation({
  args: { folderId: v.id("folders") },
  handler: async (ctx, { folderId }) => {
    await getOwnedFolder(ctx, folderId);

    const members = await ctx.db
      .query("threads")
      .withIndex("by_folder", (q) => q.eq("folderId", folderId))
      .collect();
    await Promise.all(
      members.map((thread) => ctx.db.patch(thread._id, { folderId: undefined })),
    );
    await ctx.db.delete(folderId);
    return null;
  },
});

/**
 * Persists a drag-reorder: each folder's `order` becomes its index in the
 * given list. Ids that aren't the user's folders are ignored; folders missing
 * from the list keep their old order (they sort after the reordered ones).
 */
export const reorderFolders = mutation({
  args: { folderIds: v.array(v.id("folders")) },
  handler: async (ctx, { folderIds }) => {
    const userId = await getCurrentUserId(ctx);
    const owned = new Map(
      (await listUserFolders(ctx, userId)).map((folder) => [
        folder._id,
        folder,
      ]),
    );

    const now = Date.now();
    await Promise.all(
      folderIds.map((folderId, index) => {
        const folder = owned.get(folderId);
        if (!folder || folder.order === index) return Promise.resolve();
        return ctx.db.patch(folderId, { order: index, updatedAt: now });
      }),
    );
    return null;
  },
});
