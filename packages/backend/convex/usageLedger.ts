// Billing that survives a bad round trip.
//
// Every dollar Whirl charges is a call to Autumn's API, and that call fails the
// way network calls fail: slowly, occasionally, and silently. It used to run
// best-effort behind a 4s cap — so a turn whose deduction was still in flight
// when the cap expired was simply never billed, and nothing anywhere said so.
// An expensive turn is exactly the kind that takes long enough to lose.
//
// So a charge is written down BEFORE it is sent. `chargeUsage` opens a row,
// tries to settle it immediately, and leaves it `pending` if anything at all
// goes wrong; the sweeper cron retries pending rows with backoff until Autumn
// confirms. Idempotency keys make every replay a no-op, so retrying costs the
// customer nothing and losing a charge takes a sustained outage rather than one
// unlucky request.

import { Autumn } from "autumn-js";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  AI_COST_FEATURE_ID,
  deductUsageWithOverflow,
  SEARCH_FEATURE_ID,
} from "./inference/billing";
import { captureServerEvent } from "./posthog";
import { usageChargeFeatureValidator } from "./validators";

/** The free tier's meter: one unit per message rather than a dollar figure. */
export const FREE_MESSAGES_FEATURE_ID = "messages";

export type UsageChargeFeature =
  | typeof AI_COST_FEATURE_ID
  | typeof SEARCH_FEATURE_ID
  | typeof FREE_MESSAGES_FEATURE_ID;

// Roughly 30s, 2m, 8m, 30m, 2h, then hourly — an Autumn outage is ridden out
// without hammering it, and a transient blip clears on the first retry.
const RETRY_BACKOFF_MS = [
  30_000, 120_000, 480_000, 1_800_000, 7_200_000, 3_600_000,
];
const MAX_ATTEMPTS = 8;

// Per sweep. Pending rows are a near-empty set in steady state; the cap only
// matters when draining a backlog after an outage.
const SWEEP_BATCH = 100;

// How long a settled charge is kept as a receipt before the sweeper drops it.
// Long enough to answer "was I billed for this?" about anything recent.
const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// A settle attempt gets far longer than the old 4s: the deduction is two
// sequential Autumn round trips, and the whole point is to let them finish.
// Blowing this only postpones the charge — the row stays pending.
const SETTLE_TIMEOUT_MS = 20_000;

function autumnClient(): Autumn | null {
  const secretKey = process.env.AUTUMN_SECRET_KEY;
  if (!secretKey) {
    console.error("usage_charge_no_autumn_key");
    return null;
  }
  return new Autumn({ secretKey });
}

// --- Ledger rows -------------------------------------------------------------

/**
 * Write a charge down. Returns the row to settle, or null when this exact
 * charge is already settled (or already in flight from another caller) — the
 * idempotency key is the identity of the charge, not of the call.
 *
 * `messageCost` is the raw provider cost to show on the assistant message,
 * before any usage multiplier; it lands here rather than on settle so the usage
 * tab updates with the reply instead of trailing the Autumn round trip.
 */
export const openCharge = internalMutation({
  args: {
    customerId: v.string(),
    idempotencyKey: v.string(),
    feature: usageChargeFeatureValidator,
    amount: v.number(),
    source: v.string(),
    assistantId: v.optional(v.id("messages")),
    messageCost: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("usageCharges")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .first();
    if (existing) {
      // Already recorded. A pending row is handed back so the caller's attempt
      // counts as this row's retry rather than opening a duplicate.
      return existing.status === "pending" ? existing._id : null;
    }

    if (args.assistantId && args.messageCost && args.messageCost > 0) {
      const assistant = await ctx.db.get(args.assistantId);
      if (assistant) {
        await ctx.db.patch(args.assistantId, {
          usageCost: (assistant.usageCost ?? 0) + args.messageCost,
          updatedAt: Date.now(),
        });
      }
    }

    // Nothing to report to Autumn (a $0 charge that existed only to write the
    // cost onto the message, or a 0× multiplier event) is born settled — the
    // sweeper should never pick up a row it can't do anything with.
    const now = Date.now();
    const nothingToSend = !(args.amount > 0);
    return await ctx.db.insert("usageCharges", {
      customerId: args.customerId,
      idempotencyKey: args.idempotencyKey,
      feature: args.feature,
      amount: args.amount,
      status: nothingToSend ? "settled" : "pending",
      ...(nothingToSend ? { settledAt: now } : {}),
      attempts: 0,
      nextAttemptAt: now,
      ...(args.assistantId ? { assistantId: args.assistantId } : {}),
      source: args.source,
      createdAt: now,
    });
  },
});

/** Autumn took the charge. Record the split so the usage tab can show it. */
export const markChargeSettled = internalMutation({
  args: {
    chargeId: v.id("usageCharges"),
    extraPortion: v.optional(v.number()),
  },
  handler: async (ctx, { chargeId, extraPortion }) => {
    const charge = await ctx.db.get(chargeId);
    if (!charge || charge.status === "settled") return;

    await ctx.db.patch(chargeId, {
      status: "settled",
      settledAt: Date.now(),
      attempts: charge.attempts + 1,
    });

    if (charge.assistantId && extraPortion && extraPortion > 0) {
      const assistant = await ctx.db.get(charge.assistantId);
      if (assistant) {
        await ctx.db.patch(charge.assistantId, {
          extraUsageCost: (assistant.extraUsageCost ?? 0) + extraPortion,
          updatedAt: Date.now(),
        });
      }
    }
  },
});

/**
 * Autumn didn't take it. Back off and let the sweeper try again — until the
 * attempts run out, at which point the row is parked as `failed` and shouted
 * about, because that's revenue nobody is going to collect by accident.
 */
export const markChargeAttemptFailed = internalMutation({
  args: { chargeId: v.id("usageCharges"), error: v.string() },
  handler: async (ctx, { chargeId, error }) => {
    const charge = await ctx.db.get(chargeId);
    if (!charge || charge.status === "settled") return;

    const attempts = charge.attempts + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;
    const backoff =
      RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)];

    await ctx.db.patch(chargeId, {
      attempts,
      lastError: error.slice(0, 500),
      status: exhausted ? "failed" : "pending",
      nextAttemptAt: Date.now() + backoff,
    });

    if (exhausted) {
      console.error("usage_charge_abandoned", {
        chargeId,
        customerId: charge.customerId,
        feature: charge.feature,
        amount: charge.amount,
        source: charge.source,
        attempts,
        error,
      });
    }
  },
});

/**
 * Drop settled rows once they're old enough to stop being useful. A settled
 * charge is a receipt, and there's one per message — worth keeping while a
 * billing question is still live, not worth keeping forever. Pending and
 * failed rows are never purged: those are the ones somebody still has to
 * answer for.
 */
export const purgeSettledCharges = internalMutation({
  args: { before: v.number(), limit: v.number() },
  handler: async (ctx, { before, limit }) => {
    // `nextAttemptAt` is stamped on insert and on every attempt, so for a
    // settled row it's when the charge was last touched — exactly the age we
    // want, on an index that already exists.
    const stale = await ctx.db
      .query("usageCharges")
      .withIndex("by_status_and_next_attempt", (q) =>
        q.eq("status", "settled").lte("nextAttemptAt", before),
      )
      .take(limit);
    for (const charge of stale) await ctx.db.delete(charge._id);
    return stale.length;
  },
});

/** Pending charges the sweeper may retry now, oldest deadline first. */
export const dueCharges = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, { now, limit }) =>
    await ctx.db
      .query("usageCharges")
      .withIndex("by_status_and_next_attempt", (q) =>
        q.eq("status", "pending").lte("nextAttemptAt", now),
      )
      .take(limit),
});

// --- Settling ----------------------------------------------------------------

type PendingCharge = {
  _id: Id<"usageCharges">;
  customerId: string;
  idempotencyKey: string;
  feature: UsageChargeFeature;
  amount: number;
  source: string;
};

/** Report one charge to Autumn and mark the row. Never throws. */
async function settleCharge(
  ctx: ActionCtx,
  autumn: Autumn,
  charge: PendingCharge,
): Promise<boolean> {
  try {
    const settle = async () => {
      if (charge.feature === FREE_MESSAGES_FEATURE_ID) {
        const { error } = await autumn.track({
          customer_id: charge.customerId,
          feature_id: FREE_MESSAGES_FEATURE_ID,
          value: charge.amount,
          idempotency_key: charge.idempotencyKey,
        });
        if (error) throw new Error(JSON.stringify(error));
        return { extraPortion: 0 };
      }
      return await deductUsageWithOverflow({
        autumn,
        customerId: charge.customerId,
        amount: charge.amount,
        primaryFeatureId: charge.feature,
        idempotencyKey: charge.idempotencyKey,
      });
    };

    const { extraPortion } = await Promise.race([
      settle(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Autumn did not answer in ${SETTLE_TIMEOUT_MS}ms`)),
          SETTLE_TIMEOUT_MS,
        ),
      ),
    ]);

    await ctx.runMutation(internal.usageLedger.markChargeSettled, {
      chargeId: charge._id,
      extraPortion,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("usage_charge_deferred", {
      chargeId: charge._id,
      customerId: charge.customerId,
      feature: charge.feature,
      amount: charge.amount,
      source: charge.source,
      error: message,
    });
    await ctx.runMutation(internal.usageLedger.markChargeAttemptFailed, {
      chargeId: charge._id,
      error: message,
    });
    return false;
  }
}

/**
 * Bill a customer, durably. Call this instead of touching Autumn directly:
 * whatever happens to the request, the charge is on the books and will be
 * retried until it lands. Never throws — a billing problem must never be the
 * reason a user's reply fails.
 */
export async function chargeUsage(
  ctx: ActionCtx,
  args: {
    customerId: string;
    /** Stable per logical charge — this is what Autumn dedupes on. */
    idempotencyKey: string;
    feature: UsageChargeFeature;
    /** USD to deduct (multiplier already applied), or messages to count. */
    amount: number;
    /** Where the charge came from, for reading the ledger back later. */
    source: string;
    assistantId?: Id<"messages">;
    /** Raw provider cost to show on that message, before any multiplier. */
    messageCost?: number;
  },
): Promise<void> {
  // Without billing there's no one to send a deduction to, so the charge
  // opens at zero: born settled, it still writes the turn's cost onto the
  // message and never leaves the sweeper a row it can't do anything with.
  const amount = process.env.AUTUMN_SECRET_KEY ? args.amount : 0;
  if (!(amount > 0) && !(args.messageCost && args.messageCost > 0)) return;

  try {
    const chargeId = await ctx.runMutation(internal.usageLedger.openCharge, {
      customerId: args.customerId,
      idempotencyKey: args.idempotencyKey,
      feature: args.feature,
      amount,
      source: args.source,
      ...(args.assistantId ? { assistantId: args.assistantId } : {}),
      ...(args.messageCost ? { messageCost: args.messageCost } : {}),
    });
    // Already settled, or nothing to report to Autumn (a $0 charge that only
    // existed to write the cost onto the message).
    if (!chargeId || !(amount > 0)) return;

    const autumn = autumnClient();
    if (!autumn) return;

    await settleCharge(ctx, autumn, {
      _id: chargeId,
      customerId: args.customerId,
      idempotencyKey: args.idempotencyKey,
      feature: args.feature,
      amount: args.amount,
      source: args.source,
    });
  } catch (error) {
    // Opening the row is the one step with nothing behind it, so say so loudly
    // rather than swallowing a charge that was never written down.
    console.error("usage_charge_not_recorded", {
      customerId: args.customerId,
      idempotencyKey: args.idempotencyKey,
      amount: args.amount,
      source: args.source,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Retry everything Autumn hasn't confirmed yet. Runs every minute; a no-op —
 * one indexed read — when the ledger is clean, which is nearly always.
 */
export const sweepPendingCharges = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    await ctx.runMutation(internal.usageLedger.purgeSettledCharges, {
      before: now - RECEIPT_RETENTION_MS,
      limit: SWEEP_BATCH,
    });

    const due = await ctx.runQuery(internal.usageLedger.dueCharges, {
      now,
      limit: SWEEP_BATCH,
    });
    if (due.length === 0) return;

    const autumn = autumnClient();
    if (!autumn) return;

    let settled = 0;
    for (const charge of due) {
      if (await settleCharge(ctx, autumn, charge)) settled += 1;
    }

    console.warn("usage_charge_sweep", {
      due: due.length,
      settled,
      deferred: due.length - settled,
    });
    await captureServerEvent({
      event: "usage_charge_sweep",
      distinctId: "system",
      properties: {
        due: due.length,
        settled,
        deferred: due.length - settled,
      },
    });
  },
});
