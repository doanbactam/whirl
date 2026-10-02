import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";

/** Hard cap so a runaway paste can't bloat every system prompt. */
export const MAX_PREFERENCES_LENGTH = 2000;

/** The signed-in user's free-text preferences, or null when unset. */
export const getPreferences = query({
  args: {},
  handler: async (ctx): Promise<{ text: string; updatedAt: number } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .unique();
    return row ? { text: row.text, updatedAt: row.updatedAt } : null;
  },
});

/** Upserts the signed-in user's preferences. An empty string clears them. */
export const setPreferences = mutation({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }

    const trimmed = text.trim().slice(0, MAX_PREFERENCES_LENGTH);
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .unique();

    if (!trimmed) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }

    if (existing) {
      await ctx.db.patch(existing._id, { text: trimmed, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("userPreferences", {
        userId: identity.subject,
        text: trimmed,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
