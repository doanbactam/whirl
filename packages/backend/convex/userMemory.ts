import { Autumn } from "autumn-js";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import {
  action,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { isPaidCustomer } from "./inference/billing";
import {
  isSupermemoryConfigured,
  supermemoryContainerTagForUser,
} from "./supermemory";
import {
  addSupermemoryMemory,
  deleteSupermemoryDocument,
  forgetSupermemoryMemory,
  listSupermemoryMemories,
  listSupermemorySources,
  MAX_MEMORY_CONTENT,
  updateSupermemoryMemory,
  wipeSupermemoryContainer,
  type MemoryEntry,
  type MemorySourcePage,
} from "./supermemoryManage";

/**
 * The Memory settings tab's backend. Supermemory lives behind an HTTP API, so
 * every read is an action rather than a reactive query — the client fetches
 * once and refetches after it changes something.
 *
 * Memory is a paid perk, so each entry point re-checks the plan server-side:
 * the UI hides itself for free users, but that's decoration, not a gate.
 */

/** A source document, joined with the Whirl thread it was built from. */
export type MemorySourceView = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  updatedAt: number | null;
  /** Set only when the thread still exists and belongs to the caller. */
  threadId: string | null;
  threadTitle: string | null;
};

/**
 * Resolve the container tag for the signed-in, paying caller. Throws
 * `ConvexError`s the client can show verbatim — the settings surface turns
 * `error.data` straight into a toast.
 */
async function requireMemoryAccess(ctx: ActionCtx): Promise<{
  userId: string;
  containerTag: string;
}> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Sign in to manage your memory.");
  }
  if (!isSupermemoryConfigured()) {
    throw new ConvexError("Memory isn't configured on this deployment.");
  }

  const autumnSecretKey = process.env.AUTUMN_SECRET_KEY;
  if (autumnSecretKey) {
    const autumn = new Autumn({ secretKey: autumnSecretKey });
    const paid = await isPaidCustomer({
      autumn,
      customerId: identity.subject,
    });
    if (!paid) {
      throw new ConvexError("Memory is available on paid plans.");
    }
  }

  return {
    userId: identity.subject,
    containerTag: supermemoryContainerTagForUser(identity.subject),
  };
}

/**
 * Re-throw an upstream Supermemory failure as copy a human can act on, keeping
 * the real status and body in the Convex logs. Access errors are already
 * user-facing, so they pass through untouched.
 */
function rethrowFriendly(error: unknown, message: string): never {
  if (error instanceof ConvexError) throw error;
  console.error(`[userMemory] ${message}`, error);
  throw new ConvexError(message);
}

function requireContent(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new ConvexError("A memory needs some text.");
  }
  return trimmed.slice(0, MAX_MEMORY_CONTENT);
}

/** Titles for the threads behind a page of source documents. Skips ids that
 *  have been deleted or never belonged to this user. */
export const threadTitlesForSources = internalQuery({
  args: { userId: v.string(), threadIds: v.array(v.string()) },
  handler: async (ctx, { userId, threadIds }) => {
    const titles: Record<string, string> = {};
    for (const raw of threadIds) {
      const id = ctx.db.normalizeId("threads", raw);
      if (!id) continue;
      const thread = await ctx.db.get(id);
      if (!thread || thread.userId !== userId) continue;
      titles[raw] = thread.title;
    }
    return titles;
  },
});

/** Every memory Supermemory currently holds for the caller, plus the upstream
 *  total — which is larger than the list when someone is past the page cap. */
export const listMemories = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ memories: MemoryEntry[]; totalItems: number }> => {
    const { containerTag } = await requireMemoryAccess(ctx);
    try {
      return await listSupermemoryMemories(containerTag);
    } catch (error) {
      rethrowFriendly(error, "Couldn't load your memories. Try again.");
    }
  },
});

/** Save a memory the user wrote by hand, echoing back the stored row so the
 *  list can splice it in without a refetch. */
export const addMemory = action({
  args: { content: v.string(), isStatic: v.optional(v.boolean()) },
  handler: async (ctx, { content, isStatic }): Promise<MemoryEntry | null> => {
    const { containerTag } = await requireMemoryAccess(ctx);
    const text = requireContent(content);
    try {
      return await addSupermemoryMemory({
        containerTag,
        content: text,
        isStatic: isStatic ?? false,
      });
    } catch (error) {
      rethrowFriendly(error, "Couldn't save that memory. Try again.");
    }
  },
});

/** Rewrite an existing memory. The reply carries the new version's id. */
export const editMemory = action({
  args: { id: v.string(), content: v.string() },
  handler: async (ctx, { id, content }): Promise<MemoryEntry | null> => {
    const { containerTag } = await requireMemoryAccess(ctx);
    const text = requireContent(content);
    try {
      return await updateSupermemoryMemory({ containerTag, id, content: text });
    } catch (error) {
      rethrowFriendly(error, "Couldn't update that memory. Try again.");
    }
  },
});

/** Forget one memory. */
export const forgetMemory = action({
  args: { id: v.string() },
  handler: async (ctx, { id }): Promise<null> => {
    const { containerTag } = await requireMemoryAccess(ctx);
    try {
      await forgetSupermemoryMemory({ containerTag, id });
    } catch (error) {
      rethrowFriendly(error, "Couldn't forget that memory. Try again.");
    }
    return null;
  },
});

/** One page of the chats Whirl has fed into memory. */
export const listSources = action({
  args: { page: v.optional(v.number()) },
  handler: async (
    ctx,
    { page },
  ): Promise<{
    sources: MemorySourceView[];
    page: number;
    totalPages: number;
    totalItems: number;
  }> => {
    const { userId, containerTag } = await requireMemoryAccess(ctx);

    let result: MemorySourcePage;
    try {
      result = await listSupermemorySources({
        containerTag,
        page: page ?? 1,
      });
    } catch (error) {
      rethrowFriendly(error, "Couldn't load your synced chats. Try again.");
    }

    const threadIds = [
      ...new Set(
        result.sources
          .map((source) => source.threadId)
          .filter((id): id is string => !!id),
      ),
    ];
    const titles = threadIds.length
      ? await ctx.runQuery(internal.userMemory.threadTitlesForSources, {
          userId,
          threadIds,
        })
      : {};

    return {
      page: result.page,
      totalPages: result.totalPages,
      totalItems: result.totalItems,
      sources: result.sources.map(({ threadId, ...source }) => {
        const title = threadId ? (titles[threadId] ?? null) : null;
        return {
          ...source,
          // A thread the user has since deleted shouldn't offer a dead link.
          threadId: title ? threadId : null,
          threadTitle: title,
        };
      }),
    };
  },
});

/** Remove one synced chat from memory. */
export const deleteSource = action({
  args: { id: v.string() },
  handler: async (ctx, { id }): Promise<null> => {
    await requireMemoryAccess(ctx);
    try {
      await deleteSupermemoryDocument(id);
    } catch (error) {
      rethrowFriendly(error, "Couldn't remove that chat. Try again.");
    }
    return null;
  },
});

/** Wipe the lot — every memory and every synced chat. */
export const forgetEverything = action({
  args: {},
  handler: async (ctx): Promise<{ documents: number; memories: number }> => {
    const { containerTag } = await requireMemoryAccess(ctx);
    try {
      return await wipeSupermemoryContainer(containerTag);
    } catch (error) {
      rethrowFriendly(error, "Couldn't clear your memory. Try again.");
    }
  },
});
