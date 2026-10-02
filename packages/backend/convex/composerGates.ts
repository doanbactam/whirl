import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";

// The composer's search + thinking gate choices, synced so the toggles
// follow the user across devices — same shape as modelFavorites: one row
// per user, whole-row writes (two tiny fields, toggles are rare), and the
// client keeps a localStorage mirror for instant paint and signed-out use
// (see apps/v2/lib/composer-gates.ts).

export const get = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ search: boolean; thinking: string } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("composerGates")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .unique();
    return row ? { search: row.search, thinking: row.thinking } : null;
  },
});

/** Replace the caller's gate choices. */
export const save = mutation({
  args: {
    search: v.boolean(),
    thinking: v.union(
      v.literal("none"),
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const now = Date.now();
    const row = await ctx.db
      .query("composerGates")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .unique();
    if (row) {
      await ctx.db.patch(row._id, {
        search: args.search,
        thinking: args.thinking,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("composerGates", {
        userId: identity.subject,
        search: args.search,
        thinking: args.thinking,
        updatedAt: now,
      });
    }
    return null;
  },
});
