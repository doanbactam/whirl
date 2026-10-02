// /kirkify's server side: the daily budget, and the one edit it pays for.
//
// The page can't be trusted with any of this. Its route handler on Vercel
// (apps/v2/app/api/kirkify/route.ts) is the only caller: it sees the
// visitor's IP, owns the device cookie, has the Clerk session, and has run
// BotID. It proves itself with KIRKIFY_SECRET, the same shape as the support
// agent's lookups in convex/support.ts. Configure the secret on both ends:
//
//   npx convex env set KIRKIFY_SECRET <random>
//   vercel env add KIRKIFY_SECRET
//
// A slot is reserved BEFORE the provider is called, in one transaction, so
// two requests racing for the last one can't both have it, and handed back
// whenever no picture came out of it: only finished swaps count. A loop of
// refusals costs input tokens and nothing else, and the attempt counters in
// kirkify/limits.ts bound even that.

import { Autumn } from "autumn-js";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import {
  AI_COST_FEATURE_ID,
  fetchBillingCustomer,
  hasUsageBalance,
  IMAGE_COST_MARKUP,
  readPlanState,
  snapshotGateAllowed,
  snapshotPlanState,
  USAGE_GATE,
} from "./inference/billing";
import {
  bytesToBase64,
  callOpenRouterImageGeneration,
  ImageEmptyResponseError,
  ImageGenerationHttpError,
} from "./inference/image";
import { nearestAspectRatio } from "./kirkify/aspect";
import {
  attemptKeys,
  bumpCount,
  decidePool,
  type KirkifyPool,
  type KirkifyRemaining,
  nextUtcMidnight,
  readCounts,
  summarizeRemaining,
  utcDay,
} from "./kirkify/limits";
import {
  buildKirkifyPrompt,
  KIRKIFY_FALLBACK_COST_DOLLARS,
  KIRKIFY_MODEL,
  KIRKIFY_RESOLUTION,
} from "./kirkify/prompt";
import { KIRKIFY_REFERENCES } from "./kirkify/references";
import { captureServerEvent } from "./posthog";
import { chargeUsage } from "./usageLedger";

// --- Shapes the route handler sees ------------------------------------------

export type KirkifyFailureCode =
  | "quota"
  | "capacity"
  | "invalid_image"
  | "provider"
  | "declined"
  | "config";

export type KirkifyOutcome =
  | {
      ok: true;
      /** A data URL, ready for an <img>. */
      image: string;
      pool: KirkifyPool;
      remaining: KirkifyRemaining;
    }
  | {
      ok: false;
      code: KirkifyFailureCode;
      message: string;
      /** Whether the attempt spent a slot. */
      counted: boolean;
      remaining: KirkifyRemaining | null;
    };

export type KirkifyQuota = {
  signedIn: boolean;
  paid: boolean;
  remaining: KirkifyRemaining;
  /** Epoch ms of the next midnight UTC, when every counter starts over. */
  resetsAt: number;
};

// --- Guards ------------------------------------------------------------------

/** Constant-time compare so a guessed secret can't be narrowed by timing. */
function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < given.length; i++) {
    mismatch |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

function requireSecret(given: string): void {
  const expected = process.env.KIRKIFY_SECRET;
  if (!expected) {
    throw new Error("Kirkify isn't configured (KIRKIFY_SECRET).");
  }
  if (!secretMatches(given, expected)) {
    throw new Error("Not authorized.");
  }
}

// The page downscales to ~1280px JPEG before sending, which lands well under
// a megabyte. The cap is there for a caller that isn't the page.
const MAX_IMAGE_CHARS = 4 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

function isUploadableImage(image: string): boolean {
  return image.length <= MAX_IMAGE_CHARS && IMAGE_DATA_URL.test(image);
}

/**
 * On a paid plan, with usage left to spend. A paid customer whose pool has
 * run dry gets the free pools like anybody else, rather than a refusal:
 * "you're out of usage" is the chat's message, not this page's. A billing
 * read that fails demotes to free as well, never to a free ride.
 */
async function paidWithBalance(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const secretKey = process.env.AUTUMN_SECRET_KEY;
  if (!secretKey) {
    console.error("kirkify: AUTUMN_SECRET_KEY is not set");
    return false;
  }
  const autumn = new Autumn({ secretKey });
  try {
    const customer = await fetchBillingCustomer({ autumn, customerId: userId });
    const { isPaid } = customer
      ? snapshotPlanState(customer)
      : await readPlanState({ autumn, customerId: userId });
    if (!isPaid) return false;
    return customer
      ? snapshotGateAllowed(customer, USAGE_GATE)
      : await hasUsageBalance({ autumn, customerId: userId });
  } catch (error) {
    console.error(
      "kirkify: plan lookup failed",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

// --- Failure wording ---------------------------------------------------------

function quotaMessage(signedIn: boolean): string {
  return signedIn
    ? "That's every Kirkify you get today. The counter starts over at midnight UTC."
    : "You've used today's three free Kirkifies. Sign in for five more, or come back after midnight UTC.";
}

const CAPACITY_MESSAGE =
  "Today's free batch is spoken for. Free Kirkifying opens again at midnight UTC.";
const INVALID_IMAGE_MESSAGE =
  "That doesn't look like a JPG, PNG or WebP we can work with.";
const PROVIDER_MESSAGE =
  "The model didn't answer. That one didn't count, so try again in a moment.";
const DECLINED_MESSAGE =
  "The model wouldn't edit that photo. That one didn't count, so try a different picture.";
const CONFIG_MESSAGE = "Kirkify isn't set up on this deployment yet.";

// How late into a request a second attempt may still start. The route on
// Vercel gives up at 300s (apps/v2/app/api/kirkify/route.ts); a swap runs
// about a minute, so anything past this would finish for nobody.
const RETRY_BUDGET_MS = 150_000;

type FailureVerdict = {
  code: KirkifyFailureCode;
  message: string;
  detail: string;
};

/** Why no picture came back: the provider was down, or the model wouldn't. */
function classifyFailure(error: unknown): FailureVerdict {
  const detail = error instanceof Error ? error.message : String(error);
  if (error instanceof ImageEmptyResponseError) {
    return { code: "declined", message: DECLINED_MESSAGE, detail };
  }
  if (error instanceof ImageGenerationHttpError) {
    const outage = error.status === 429 || error.status >= 500;
    return outage
      ? { code: "provider", message: PROVIDER_MESSAGE, detail }
      : { code: "declined", message: DECLINED_MESSAGE, detail };
  }
  // fetch itself failed: DNS, a reset, a timeout. Nothing reached the model.
  return { code: "provider", message: PROVIDER_MESSAGE, detail };
}

/**
 * The model answered but didn't paint. Gemini does this now and then on a
 * photo it will happily edit a moment later, so one retry is worth its
 * input tokens before the visitor is told no.
 */
function paintedNothing(error: unknown): boolean {
  return (
    error instanceof ImageEmptyResponseError ||
    (error instanceof ImageGenerationHttpError &&
      error.status === 400 &&
      /could not generate an image/i.test(error.message))
  );
}

// --- Billing -----------------------------------------------------------------

async function billPaidRun(
  ctx: ActionCtx,
  { userId, runId, cost }: { userId: string; runId: Id<"kirkifyRuns">; cost: number },
): Promise<void> {
  // Same shape as the chat's image tool: marked-up provider cost, scaled by
  // any active usage multiplier, through the ledger so a billing hiccup
  // postpones the charge instead of losing it.
  const multiplierEvent = await ctx.runQuery(
    internal.admin.getActiveMultiplierInternal,
    {},
  );
  const billed = cost * IMAGE_COST_MARKUP;
  await chargeUsage(ctx, {
    customerId: userId,
    idempotencyKey: `kirkify:${runId}`,
    feature: AI_COST_FEATURE_ID,
    amount: billed * (multiplierEvent?.multiplier ?? 1),
    source: "kirkify",
  });
}

// --- Public actions (secret-gated) ------------------------------------------

type Reservation =
  | {
      ok: true;
      pool: KirkifyPool;
      runId: Id<"kirkifyRuns">;
      keys: string[];
      remaining: KirkifyRemaining;
    }
  | {
      ok: false;
      reason: "exhausted" | "capacity";
      remaining: KirkifyRemaining;
    };

/** What the visitor has left today. Drives the page's counter. */
export const quota = action({
  args: {
    secret: v.string(),
    ipHash: v.string(),
    deviceId: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<KirkifyQuota> => {
    requireSecret(args.secret);
    const userId = args.userId ?? null;
    const [paid, remaining] = await Promise.all([
      paidWithBalance(userId),
      ctx.runQuery(internal.kirkify.readRemaining, {
        ipHash: args.ipHash,
        deviceId: args.deviceId,
        ...(userId ? { userId } : {}),
      }) as Promise<KirkifyRemaining>,
    ]);
    return {
      signedIn: userId !== null,
      paid,
      remaining,
      resetsAt: nextUtcMidnight(Date.now()),
    };
  },
});

/** One Kirkify: reserve a slot, run the swap, settle the books. */
export const generate = action({
  args: {
    secret: v.string(),
    ipHash: v.string(),
    deviceId: v.string(),
    userId: v.optional(v.string()),
    image: v.string(),
    /** The photo's pixel size. Only picks the output shape, so it's
     *  taken on trust. */
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<KirkifyOutcome> => {
    requireSecret(args.secret);
    const startedAt = Date.now();
    const userId = args.userId ?? null;

    if (!isUploadableImage(args.image)) {
      return {
        ok: false,
        code: "invalid_image",
        message: INVALID_IMAGE_MESSAGE,
        counted: false,
        remaining: null,
      };
    }

    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterApiKey) {
      console.error("kirkify: OPENROUTER_API_KEY is not set");
      return {
        ok: false,
        code: "config",
        message: CONFIG_MESSAGE,
        counted: false,
        remaining: null,
      };
    }

    const paid = await paidWithBalance(userId);
    const reservation: Reservation = await ctx.runMutation(
      internal.kirkify.reserve,
      {
        ipHash: args.ipHash,
        deviceId: args.deviceId,
        ...(userId ? { userId } : {}),
        paid,
        model: KIRKIFY_MODEL,
      },
    );
    if (!reservation.ok) {
      return {
        ok: false,
        code: reservation.reason === "capacity" ? "capacity" : "quota",
        message:
          reservation.reason === "capacity"
            ? CAPACITY_MESSAGE
            : quotaMessage(userId !== null),
        counted: false,
        remaining: reservation.remaining,
      };
    }

    const distinctId = userId ?? `kirkify-device:${args.deviceId}`;

    const paint = () =>
      callOpenRouterImageGeneration({
        apiKey: openRouterApiKey,
        model: KIRKIFY_MODEL,
        prompt: buildKirkifyPrompt({ referenceCount: KIRKIFY_REFERENCES.length }),
        // References first, the photo to edit last, matching the numbering
        // in the prompt.
        inputReferences: [
          ...KIRKIFY_REFERENCES,
          { name: "photo", url: args.image },
        ],
        // gpt-image-2's quality knob means nothing to this model.
        quality: null,
        outputFormat: "jpeg",
        aspectRatio: nearestAspectRatio(args.width, args.height),
        resolution: KIRKIFY_RESOLUTION,
      });

    try {
      let result: Awaited<ReturnType<typeof paint>>;
      try {
        result = await paint();
      } catch (error) {
        // Only while there's time for a second full run inside the route's
        // ceiling; a slow refusal isn't worth a swap nobody is waiting for.
        const retryable =
          paintedNothing(error) && Date.now() - startedAt < RETRY_BUDGET_MS;
        if (!retryable) throw error;
        console.warn("kirkify: the model painted nothing, trying once more");
        result = await paint();
      }

      const painted = result.images[0];
      const bytes = new Uint8Array(await painted.blob.arrayBuffer());
      const image = `data:${painted.mediaType};base64,${bytesToBase64(bytes)}`;

      let costDollars = result.cost ?? null;
      if (reservation.pool === "paid" && userId) {
        if (costDollars === null) {
          console.warn("kirkify: provider reported no cost, billing the fallback");
          costDollars = KIRKIFY_FALLBACK_COST_DOLLARS;
        }
        await billPaidRun(ctx, {
          userId,
          runId: reservation.runId,
          cost: costDollars,
        });
      }

      const durationMs = Date.now() - startedAt;
      await ctx.runMutation(internal.kirkify.settle, {
        runId: reservation.runId,
        ...(costDollars !== null ? { costDollars } : {}),
        durationMs,
      });
      await captureServerEvent({
        event: "kirkify_generated",
        distinctId,
        properties: {
          ok: true,
          pool: reservation.pool,
          provider_cost: costDollars,
          duration_ms: durationMs,
          image_model: KIRKIFY_MODEL,
        },
      });

      return {
        ok: true,
        image,
        pool: reservation.pool,
        remaining: reservation.remaining,
      };
    } catch (error) {
      const verdict = classifyFailure(error);
      const durationMs = Date.now() - startedAt;
      console.error(
        `kirkify failed (${reservation.pool}, ${verdict.code}, ${durationMs}ms): ${verdict.detail}`,
      );

      const remaining: KirkifyRemaining = await ctx.runMutation(
        internal.kirkify.refund,
        {
          runId: reservation.runId,
          keys: reservation.keys,
          ipHash: args.ipHash,
          deviceId: args.deviceId,
          ...(userId ? { userId } : {}),
          error: verdict.detail,
          durationMs,
        },
      );

      await captureServerEvent({
        event: "kirkify_generated",
        distinctId,
        properties: {
          ok: false,
          pool: reservation.pool,
          code: verdict.code,
          duration_ms: durationMs,
          image_model: KIRKIFY_MODEL,
          error: verdict.detail,
        },
      });

      return {
        ok: false,
        code: verdict.code,
        message: verdict.message,
        counted: false,
        remaining,
      };
    }
  },
});

// --- The counters ------------------------------------------------------------

export const readRemaining = internalQuery({
  args: {
    ipHash: v.string(),
    deviceId: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<KirkifyRemaining> => {
    const visitor = {
      ipHash: args.ipHash,
      deviceId: args.deviceId,
      userId: args.userId ?? null,
    };
    const counts = await readCounts(ctx, visitor, utcDay(Date.now()));
    return summarizeRemaining(counts, visitor);
  },
});

/**
 * Take a slot, or say why not. Reads and bumps every counter in one
 * transaction, which is what makes the limit hold under concurrent requests.
 */
export const reserve = internalMutation({
  args: {
    ipHash: v.string(),
    deviceId: v.string(),
    userId: v.optional(v.string()),
    paid: v.boolean(),
    model: v.string(),
  },
  handler: async (ctx, args): Promise<Reservation> => {
    const now = Date.now();
    const day = utcDay(now);
    const visitor = {
      ipHash: args.ipHash,
      deviceId: args.deviceId,
      userId: args.userId ?? null,
      paid: args.paid,
    };

    const counts = await readCounts(ctx, visitor, day);
    const decision = decidePool(counts, visitor);
    if (!decision.ok) {
      return {
        ok: false,
        reason: decision.reason,
        remaining: summarizeRemaining(counts, visitor),
      };
    }

    // The pool's counters come back on a refund; the attempt counters never do.
    for (const key of [...decision.keys, ...attemptKeys(visitor)]) {
      await bumpCount(ctx, key, day, 1);
    }
    const runId = await ctx.db.insert("kirkifyRuns", {
      day,
      pool: decision.pool,
      status: "running",
      ipHash: args.ipHash,
      deviceId: args.deviceId,
      ...(args.userId ? { userId: args.userId } : {}),
      model: args.model,
      createdAt: now,
    });

    const after = await readCounts(ctx, visitor, day);
    return {
      ok: true,
      pool: decision.pool,
      runId,
      keys: decision.keys,
      remaining: summarizeRemaining(after, visitor),
    };
  },
});

/** A picture came back. Only these runs ever hold a cost. */
export const settle = internalMutation({
  args: {
    runId: v.id("kirkifyRuns"),
    costDollars: v.optional(v.number()),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    await ctx.db.patch(args.runId, {
      status: "done",
      durationMs: args.durationMs,
      ...(args.costDollars !== undefined ? { costDollars: args.costDollars } : {}),
    });
    return null;
  },
});

/** Hand a slot back. Decrements against the run's own day, not today's. */
export const refund = internalMutation({
  args: {
    runId: v.id("kirkifyRuns"),
    keys: v.array(v.string()),
    ipHash: v.string(),
    deviceId: v.string(),
    userId: v.optional(v.string()),
    error: v.string(),
    durationMs: v.number(),
  },
  handler: async (ctx, args): Promise<KirkifyRemaining> => {
    const visitor = {
      ipHash: args.ipHash,
      deviceId: args.deviceId,
      userId: args.userId ?? null,
    };
    const run = await ctx.db.get(args.runId);
    const day = run?.day ?? utcDay(Date.now());
    if (run && run.status === "running") {
      for (const key of args.keys) {
        await bumpCount(ctx, key, day, -1);
      }
      await ctx.db.patch(args.runId, {
        status: "refunded",
        error: args.error.slice(0, 500),
        durationMs: args.durationMs,
      });
    }
    const counts = await readCounts(ctx, visitor, utcDay(Date.now()));
    return summarizeRemaining(counts, visitor);
  },
});

// Counters are meaningless once their day is over; the run log is kept a
// month so "what did Tuesday cost" can still be answered. Yesterday's
// counters stay one extra day so a refund landing just after midnight still
// finds its row.
const QUOTA_RETENTION_DAYS = 2;
const RUN_RETENTION_DAYS = 30;
const SWEEP_BATCH = 200;

export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const quotaCutoff = utcDay(now - QUOTA_RETENTION_DAYS * dayMs);
    const runCutoff = utcDay(now - RUN_RETENTION_DAYS * dayMs);

    const staleQuota = await ctx.db
      .query("kirkifyQuota")
      .withIndex("by_day", (q) => q.lt("day", quotaCutoff))
      .take(SWEEP_BATCH);
    for (const row of staleQuota) await ctx.db.delete(row._id);

    const staleRuns = await ctx.db
      .query("kirkifyRuns")
      .withIndex("by_day", (q) => q.lt("day", runCutoff))
      .take(SWEEP_BATCH);
    for (const row of staleRuns) await ctx.db.delete(row._id);

    if (staleQuota.length === SWEEP_BATCH || staleRuns.length === SWEEP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.kirkify.sweep, {});
    }
    return null;
  },
});
