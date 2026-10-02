import { ConvexError, v } from "convex/values";

import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

// Legacy local memory caps. New extraction/search is handled by Supermemory,
// but old local rows can still be viewed from historical message indicators.
export const MAX_MEMORY_LENGTH = 300;
export const MAX_MEMORIES = 200;

type MemoryView = {
  id: Id<"memories">;
  text: string;
  createdAt: number;
  updatedAt: number;
};

function toView(row: Doc<"memories">): MemoryView {
  return {
    id: row._id,
    text: row.text,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireUserId(ctx: {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not authenticated");
  return identity.subject;
}

/** The signed-in user's memories, newest first. */
export const listMemories = query({
  args: {},
  handler: async (ctx): Promise<MemoryView[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).map(toView);
  },
});

/** The specific memories saved by one assistant turn (for the message
 * indicator modal). Skips any since deleted or not owned by the caller. */
export const getMemoriesByIds = query({
  args: { ids: v.array(v.id("memories")) },
  handler: async (ctx, { ids }): Promise<MemoryView[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return rows
      .filter(
        (row): row is Doc<"memories"> =>
          row !== null && row.userId === identity.subject,
      )
      .map(toView);
  },
});

/** Whether memory is on for the signed-in user. Defaults to on. */
export const getMemorySettings = query({
  args: {},
  handler: async (ctx): Promise<{ enabled: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { enabled: true };
    const row = await ctx.db
      .query("memorySettings")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .unique();
    return { enabled: row?.enabled ?? true };
  },
});

/** Turn memory on or off for the signed-in user. */
export const setMemoryEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("memorySettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { enabled, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("memorySettings", {
        userId,
        enabled,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Edit a memory's text. An empty value deletes it. */
export const updateMemory = mutation({
  args: { id: v.id("memories"), text: v.string() },
  handler: async (ctx, { id, text }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) throw new Error("Memory not found");

    const trimmed = text.trim().slice(0, MAX_MEMORY_LENGTH);
    if (!trimmed) {
      await ctx.db.delete(id);
      return null;
    }
    await ctx.db.patch(id, { text: trimmed, updatedAt: Date.now() });
    return null;
  },
});

/** Delete a single memory. */
export const deleteMemory = mutation({
  args: { id: v.id("memories") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) throw new Error("Memory not found");
    await ctx.db.delete(id);
    return null;
  },
});

/** Wipe every memory for the signed-in user. */
export const clearMemories = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
    return null;
  },
});

/**
 * Shared write core for the legacy local memory store. Inserts each new bullet
 * for `userId`, skipping blanks and case-insensitive duplicates and stopping at
 * MAX_MEMORIES, stamping `sourceMessageId` when given. Returns the ids actually
 * inserted. Used by old local-memory flows only; new turns write to Supermemory.
 */
async function insertMemories(
  ctx: MutationCtx,
  {
    userId,
    texts,
    sourceMessageId,
  }: { userId: string; texts: string[]; sourceMessageId?: Id<"messages"> },
): Promise<Id<"memories">[]> {
  const existing = await ctx.db
    .query("memories")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const seen = new Set(existing.map((row) => row.text.trim().toLowerCase()));
  let count = existing.length;

  const now = Date.now();
  const insertedIds: Id<"memories">[] = [];
  for (const raw of texts) {
    if (count >= MAX_MEMORIES) break;
    const trimmed = raw.trim().slice(0, MAX_MEMORY_LENGTH);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    count += 1;
    const id = await ctx.db.insert("memories", {
      userId,
      text: trimmed,
      createdAt: now,
      updatedAt: now,
      ...(sourceMessageId ? { sourceMessageId } : {}),
    });
    insertedIds.push(id);
  }
  return insertedIds;
}

/**
 * Persist memories saved by the `remember` tool during a turn, and stamp the
 * ids onto the assistant message so its indicator knows what it added. Skips
 * blank or duplicate bullets (case-insensitive) and stops at MAX_MEMORIES.
 * Internal: only the inference action calls this, after gating on paid + on.
 */
export const recordMemories = internalMutation({
  args: {
    userId: v.string(),
    assistantId: v.id("messages"),
    texts: v.array(v.string()),
  },
  handler: async (ctx, { userId, assistantId, texts }) => {
    const insertedIds = await insertMemories(ctx, {
      userId,
      texts,
      sourceMessageId: assistantId,
    });

    if (insertedIds.length > 0) {
      const assistant = await ctx.db.get(assistantId);
      if (assistant) {
        await ctx.db.patch(assistantId, {
          addedMemoryIds: [...(assistant.addedMemoryIds ?? []), ...insertedIds],
        });
      }
    }

    return { added: insertedIds.length };
  },
});

/**
 * Persist memories mined by the legacy background index. Same dedup/cap rules as
 * `recordMemories`, but not tied to a single assistant turn — the sweep visits
 * many threads — so nothing is stamped onto a message. Internal: only the
 * Legacy Memory Index action called this, after gating on paid + on.
 */
export const recordMemoriesForUser = internalMutation({
  args: {
    userId: v.string(),
    texts: v.array(v.string()),
  },
  handler: async (ctx, { userId, texts }) => {
    const insertedIds = await insertMemories(ctx, { userId, texts });
    return { added: insertedIds.length };
  },
});

/** Every legacy local memory text for a user. Internal: callable only by other
 * functions. */
export const listMemoryTextsForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<string[]> => {
    const rows = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((row) => row.text);
  },
});
