import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { generateSuggestionBatch } from "./suggestions/generate";
import { compactText } from "./suggestions/text";
import { homeSuggestionValidator } from "./validators";

/** Cards on the home screen. */
const VISIBLE_COUNT = 2;
/** Generated at once: two to show, four to spend on dismissals. */
const BATCH_COUNT = 6;
/** How much dismissal history the model is asked to avoid repeating. */
const DISMISSED_LIMIT = 18;
const MAX_PROMPT_CHARS = 120;
/* A generation lease. Long enough to cover a slow model call, short enough
   that a crashed action heals on the next visit instead of wedging the cards
   in their loading state forever. */
const CLAIM_TTL_MS = 90_000;

/* Stored and sent with `icon` as a plain string: the writers only ever hand
   over icons that passed suggestions/parse.ts or came from the standby pool,
   and the client validates once more against its own glyph registry before
   rendering. Narrowing it here would buy nothing and force a cast at every
   database read. */
type StoredSuggestion = Doc<"homeSuggestions">["visible"][number];

export type HomeSuggestionState = {
  visible: StoredSuggestion[];
  reserve: StoredSuggestion[];
  /** The card waiting on a replacement, if any. */
  pendingSlot: number | null;
};

function stateOf(row: Doc<"homeSuggestions"> | null): HomeSuggestionState {
  return {
    visible: row?.visible ?? [],
    reserve: row?.reserve ?? [],
    pendingSlot: row?.pendingSlot ?? null,
  };
}

function rowForUser(ctx: MutationCtx, userId: string) {
  return ctx.db
    .query("homeSuggestions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

function claimIsLive(row: Doc<"homeSuggestions"> | null, now: number) {
  return row?.claimedAt != null && now - row.claimedAt < CLAIM_TTL_MS;
}

/** The two starters this user is looking at, plus the queue behind them.
 * Returns empty arrays before the first batch exists — the client shows its
 * loading cards and asks for one. */
export const get = query({
  args: {},
  handler: async (ctx): Promise<HomeSuggestionState> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return stateOf(null);

    const row = await ctx.db
      .query("homeSuggestions")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .unique();
    return stateOf(row);
  },
});

/** Turn down a card. The replacement comes out of the reserve, which is why
 * this costs nothing and lands instantly; only an empty reserve marks the slot
 * pending and asks the client to pay for a new batch. */
export const dismiss = mutation({
  args: { slot: v.number() },
  handler: async (ctx, { slot }): Promise<{ needsBatch: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const row = await rowForUser(ctx, identity.subject);
    if (!row) return { needsBatch: true };

    const index = Math.floor(slot);
    const current = row.visible[index];
    if (!current) return { needsBatch: row.visible.length < VISIBLE_COUNT };

    const dismissed = [...row.dismissed, current.prompt].slice(-DISMISSED_LIMIT);
    const [next, ...rest] = row.reserve;
    await ctx.db.patch(row._id, {
      /* The dismissed card stays in place until its replacement exists — the
         client hides it behind a loading state, and leaving it means a failed
         batch degrades to "unchanged" rather than "blank". */
      visible: next
        ? row.visible.map((suggestion, at) => (at === index ? next : suggestion))
        : row.visible,
      reserve: next ? rest : row.reserve,
      dismissed,
      pendingSlot: next ? row.pendingSlot : index,
      updatedAt: Date.now(),
    });
    return { needsBatch: !next };
  },
});

/** Take the generation lease, or report that someone else holds it.
 *
 * This is the gate that protects a user's usage pool. Whether a batch gets
 * paid for is decided here, from the stored row — never from whatever the
 * browser happens to have cached. A second tab, a hard refresh, or a cleared
 * localStorage all arrive to find the work already done or already claimed. */
export const claimBatch = internalMutation({
  args: { userId: v.string() },
  handler: async (
    ctx,
    { userId },
  ): Promise<{ claimed: boolean; excluded: string[] }> => {
    const now = Date.now();
    const row = await rowForUser(ctx, userId);

    const wanted =
      !row || row.visible.length < VISIBLE_COUNT || row.pendingSlot != null;
    if (!wanted || claimIsLive(row, now)) {
      return { claimed: false, excluded: [] };
    }

    if (!row) {
      await ctx.db.insert("homeSuggestions", {
        userId,
        visible: [],
        reserve: [],
        dismissed: [],
        claimedAt: now,
        updatedAt: now,
      });
      return { claimed: true, excluded: [] };
    }

    await ctx.db.patch(row._id, { claimedAt: now, updatedAt: now });
    return {
      claimed: true,
      /* Everything the batch must not echo: what is on screen, what is queued
         behind it, and what has already been turned down. */
      excluded: [
        ...row.dismissed,
        ...row.reserve.map((suggestion) => suggestion.prompt),
        ...row.visible.map((suggestion) => suggestion.prompt),
      ],
    };
  },
});

/** Place a finished batch: into the pending card if one is waiting, otherwise
 * across both cards. Re-reads the row, so a dismissal that landed mid-flight
 * still gets its replacement. */
export const applyBatch = internalMutation({
  args: {
    userId: v.string(),
    suggestions: v.array(homeSuggestionValidator),
  },
  handler: async (ctx, { userId, suggestions }) => {
    const row = await rowForUser(ctx, userId);
    if (!row) return;

    const batch = suggestions.map((suggestion) => ({
      prompt: compactText(suggestion.prompt, MAX_PROMPT_CHARS),
      icon: suggestion.icon,
    }));
    const pending = row.pendingSlot;

    if (pending != null && row.visible.length === VISIBLE_COUNT) {
      const [replacement, ...rest] = batch;
      await ctx.db.patch(row._id, {
        visible: replacement
          ? row.visible.map((suggestion, at) =>
              at === pending ? replacement : suggestion,
            )
          : row.visible,
        reserve: replacement ? [...row.reserve, ...rest] : row.reserve,
        pendingSlot: undefined,
        claimedAt: undefined,
        updatedAt: Date.now(),
      });
      return;
    }

    await ctx.db.patch(row._id, {
      visible: batch.slice(0, VISIBLE_COUNT),
      reserve: batch.slice(VISIBLE_COUNT),
      pendingSlot: undefined,
      claimedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

/** Drop the lease without writing a batch, so the next attempt can retry
 * immediately instead of waiting the lease out. */
export const releaseClaim = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const row = await rowForUser(ctx, userId);
    if (!row?.claimedAt) return;
    await ctx.db.patch(row._id, { claimedAt: undefined, updatedAt: Date.now() });
  },
});

/** Fill whatever the stored state says is missing — the first batch, or the
 * replacement for a dismissed card. A no-op when nothing is missing, so the
 * client can call it on every visit without ever buying a second batch. */
export const replenish = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject;

    const { claimed, excluded }: { claimed: boolean; excluded: string[] } =
      await ctx.runMutation(internal.homeSuggestions.claimBatch, { userId });
    if (!claimed) return;

    try {
      const suggestions = await generateSuggestionBatch({
        ctx,
        userId,
        count: BATCH_COUNT,
        excluded,
      });
      await ctx.runMutation(internal.homeSuggestions.applyBatch, {
        userId,
        suggestions,
      });
    } catch (error) {
      await ctx.runMutation(internal.homeSuggestions.releaseClaim, { userId });
      throw error;
    }
  },
});
