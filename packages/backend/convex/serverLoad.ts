// Server-overload throttle state. We read how much free-tier traffic has cost
// Whirl so far today from a PostHog endpoint, cache it in a singleton row, and
// expose a vague severity + tightened message cap to clients. The inference
// path reads the cached row and schedules a background refresh when stale; a
// cron keeps it warm for the client notice. Paid users are never affected — the
// cap only narrows the free `messages` allowance.

import { v } from "convex/values";

import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import {
  resolveOverloadCap,
  resolveOverloadLevel,
} from "./inference/billing";
import { fetchFreeUserDailyCost } from "./posthog";

// Read the cached free-user daily cost (USD), plus freshness metadata.
export const getFreeCostSnapshotInternal = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ freeCostUsd: number | null; updatedAt: number | null }> => {
    const row = await ctx.db.query("serverLoad").first();
    return {
      freeCostUsd: row?.freeCostUsd ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  },
});

// Upsert the singleton cache row with the latest free-user daily cost.
export const setFreeCost = internalMutation({
  args: { freeCostUsd: v.number() },
  handler: async (ctx, { freeCostUsd }) => {
    const existing = await ctx.db.query("serverLoad").first();
    const doc = { freeCostUsd, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("serverLoad", doc);
    }
    return null;
  },
});

/**
 * Fetch the latest free-user daily cost from PostHog and cache it. Returns the
 * cost (or null when the lookup is unavailable). Scheduled by the cron to keep
 * the client notice warm and by inference when the cached value is stale.
 */
export const refresh = internalAction({
  args: {},
  handler: async (ctx): Promise<number | null> => {
    const cost = await fetchFreeUserDailyCost();
    if (cost !== null) {
      await ctx.runMutation(internal.serverLoad.setFreeCost, {
        freeCostUsd: cost,
      });
    }
    return cost;
  },
});

/**
 * Current server-load state for the client's under-composer notice. Vague by
 * design: exposes only a severity `level` (0 = normal, higher = more throttled)
 * and the tightened `cap`, never the underlying dollar figure. Harmless to any
 * caller — only free users are ever throttled, and the client gates display on
 * that itself.
 */
export const getServerLoad = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("serverLoad").first();
    const costUsd = row?.freeCostUsd ?? null;
    return {
      level: resolveOverloadLevel(costUsd),
      cap: resolveOverloadCap(costUsd),
      updatedAt: row?.updatedAt ?? null,
    };
  },
});
