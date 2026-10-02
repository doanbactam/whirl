import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";

// The composer picker's starred models, synced so favorites follow the user
// across devices. The list is opaque view state to the backend — tier keys
// ("Auto") and catalog slugs ("anthropic/claude-fable-5") mixed; the client
// prunes stale keys against its own lineup. One row per user, whole-list
// writes (favorites are small and toggles are rare — no need for deltas).

const MAX_KEYS = 100;
const MAX_KEY_LENGTH = 200;

/** The caller's saved favorites; null while signed out or never saved —
 *  the client keeps its local defaults in both cases. */
export const get = query({
  args: {},
  handler: async (ctx): Promise<string[] | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("modelFavorites")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .unique();
    return row?.keys ?? null;
  },
});

/** Replace the caller's favorites with this list. */
export const save = mutation({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const keys = [
      ...new Set(
        args.keys
          .map((key) => key.trim())
          .filter((key) => key.length > 0 && key.length <= MAX_KEY_LENGTH),
      ),
    ].slice(0, MAX_KEYS);

    const now = Date.now();
    const row = await ctx.db
      .query("modelFavorites")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .unique();
    if (row) {
      await ctx.db.patch(row._id, { keys, updatedAt: now });
    } else {
      await ctx.db.insert("modelFavorites", {
        userId: identity.subject,
        keys,
        updatedAt: now,
      });
    }
    return null;
  },
});
