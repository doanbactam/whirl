import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { GenericDatabaseReader } from "convex/server";
import { MODEL_IDS, type ModelKey } from "./inference/billing";
import { readTierOverride } from "./models";

/* Which models can serve a locked chat.
 *
 * Zero data retention is a property of the endpoints behind a model, not
 * something we can know by looking at a slug — and it moves as providers
 * come and go. OpenRouter publishes the answer, so that is where it comes
 * from: `GET /models?zdr=true` lists every model with at least one endpoint
 * that does not retain prompts.
 *
 * The list is cached in one row and refreshed on a cron, because reading it
 * has to be cheap: the composer asks on every locked thread, and the turn
 * handler asks before it spends anything.
 *
 * This replaced a hardcoded list of tiers, which was wrong in both
 * directions. It excluded the Free tier, whose model does have ZDR
 * endpoints. And it flagged tiers rather than the models actually serving
 * them, so an admin repointing a tier would have kept the badge and lost
 * the property. */

const OPENROUTER_ZDR_URL = "https://openrouter.ai/api/v1/models?zdr=true";

/** How stale the cache may get before the cron's next pass matters. The set
 *  moves when providers do, which is on the order of days. */
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

type ZdrModelsResponse = {
  data?: { id?: string }[];
  error?: { message?: string };
};

type Reader = GenericDatabaseReader<DataModel>;

/** The cleared set, resolved against what each tier currently routes to.
 *
 * `known` is false when we have never successfully read the list. Callers
 * must treat that as "clear nothing": a locked chat that can't verify a
 * model's retention has no business sending it a conversation. */
async function readCleared(db: Reader) {
  const row = await db.query("zeroRetentionModels").first();
  const zdr = new Set(row?.slugs ?? []);

  const tiers: string[] = [];
  for (const tier of TIER_KEYS) {
    // Image paints, it doesn't converse. Auto is a router and picks a
    // different endpoint per request, so neither can carry the promise.
    if (tier === "Image" || tier === "Auto") continue;
    const override = await readTierOverride(db, tier);
    const slug = override?.slug ?? MODEL_IDS[tier];
    if (zdr.has(slug)) tiers.push(tier);
  }

  const catalog = await db
    .query("models")
    .withIndex("by_enabled", (q) => q.eq("enabled", true))
    .collect();
  const slugs = catalog
    .filter((model) => model.tier === undefined && zdr.has(model.slug))
    .map((model) => model.slug);

  return { tiers, slugs, known: zdr.size > 0 };
}

const TIER_KEYS: readonly ModelKey[] = ["Auto", "Fast", "Basic", "Max", "Image"];

/* ---- the cache --------------------------------------------------------- */

export const zdrSnapshot = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("zeroRetentionModels").first();
    return {
      count: row?.slugs.length ?? 0,
      stale: !row || Date.now() - row.updatedAt > STALE_AFTER_MS,
    };
  },
});

export const saveZdrSnapshot = internalMutation({
  args: { slugs: v.array(v.string()) },
  handler: async (ctx, { slugs }) => {
    const row = await ctx.db.query("zeroRetentionModels").first();
    if (row) {
      await ctx.db.patch(row._id, { slugs, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("zeroRetentionModels", {
        slugs,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/**
 * Re-read the list from OpenRouter. Leaves the previous answer in place on
 * any failure: a stale list closes nothing, where an empty one would close
 * every locked chat at once.
 */
export const refresh = internalAction({
  args: {},
  handler: async (ctx) => {
    let response: Response;
    try {
      response = await fetch(OPENROUTER_ZDR_URL);
    } catch {
      console.error("zdr_refresh_unreachable");
      return null;
    }
    if (!response.ok) {
      console.error("zdr_refresh_rejected", { status: response.status });
      return null;
    }

    let parsed: ZdrModelsResponse;
    try {
      parsed = (await response.json()) as ZdrModelsResponse;
    } catch {
      console.error("zdr_refresh_unparsable");
      return null;
    }

    const slugs = (parsed.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (slugs.length === 0) {
      // A well-formed answer with nothing in it is far likelier to be a bad
      // day at OpenRouter than a world where no model retains nothing.
      console.error("zdr_refresh_empty");
      return null;
    }

    await ctx.runMutation(internal.zeroRetention.saveZdrSnapshot, { slugs });
    console.log("zdr_refresh_ok", { count: slugs.length });
    return null;
  },
});

/* ---- what the two callers ask ---------------------------------------- */

/** The turn handler's copy, before it spends anything. */
export const clearedForLockedThreads = internalQuery({
  args: {},
  handler: async (ctx) => readCleared(ctx.db),
});

/**
 * Public: the composer offers only what a locked chat can run, and refuses
 * to send anything else. The turn handler checks the same thing, so this is
 * a courtesy rather than the guarantee — but it's the difference between
 * picking a model and finding out after typing a message.
 */
export const lockedModels = query({
  args: {},
  handler: async (ctx) => readCleared(ctx.db),
});
