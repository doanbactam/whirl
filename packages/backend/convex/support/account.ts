// The customer's plan, allowance, and memory switch, for the support agent.
//
// This module reads Autumn on the tool route's behalf, so AUTUMN_SECRET_KEY
// stays a Convex secret and never has to be handed to the web app. See
// guard.ts for how the route gets in.

import { Autumn } from "autumn-js";
import { v } from "convex/values";

import { internal } from "../_generated/api";
import { action, internalQuery } from "../_generated/server";
import {
  EXTRA_USAGE_FEATURE_ID,
  PAID_PRODUCT_IDS,
  USAGE_FEATURE_ID,
} from "../inference/billing";
import { assertSupportSecret } from "./guard";

/** `past_due` still counts, so a lapsed card doesn't read as a downgrade. */
const IN_FORCE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Autumn's count meter for the free plan, and its fallback allowance. */
const FREE_MESSAGES_FEATURE_ID = "messages";
const FREE_MESSAGE_LIMIT = 15;

type PlanProduct = {
  id: string;
  name?: string | null;
  status?: string | null;
  is_add_on?: boolean;
  canceled_at?: number | null;
  current_period_end?: number | null;
  trial_ends_at?: number | null;
};

type CustomerFeature = {
  unlimited?: boolean | null;
  balance?: number | null;
  included_usage?: number | null;
  next_reset_at?: number | null;
};

type SupportCustomer = {
  products?: PlanProduct[];
  features?: Record<string, CustomerFeature | undefined>;
};

export type AccountSnapshot = {
  known: boolean;
  planId: string | null;
  planName: string;
  planStatus: string | null;
  /** Epoch ms. When the current period ends, which is also when a cancelled plan lapses. */
  periodEndsAt: number | null;
  cancelsAtPeriodEnd: boolean;
  trialEndsAt: number | null;
  /** Free plans are metered by a message count, paid plans by a USD pool. */
  metering: "messages" | "usage";
  unlimited: boolean;
  /** 0-100, how much of the allowance is left. */
  remainingPct: number;
  freeMessagesRemaining: number | null;
  freeMessagesIncluded: number | null;
  /** Epoch ms of the next refill, when Autumn reported one. */
  nextResetAt: number | null;
  /** The separate top-up bucket. Only spent once the plan pool runs dry. */
  extraUsageBalance: number | null;
};

const UNKNOWN: AccountSnapshot = {
  known: false,
  planId: null,
  planName: "Free",
  planStatus: null,
  periodEndsAt: null,
  cancelsAtPeriodEnd: false,
  trialEndsAt: null,
  metering: "messages",
  unlimited: false,
  remainingPct: 100,
  freeMessagesRemaining: null,
  freeMessagesIncluded: null,
  nextResetAt: null,
  extraUsageBalance: null,
};

function activePlan(customer: SupportCustomer): PlanProduct | undefined {
  return customer.products?.find(
    (product) =>
      !product.is_add_on &&
      (PAID_PRODUCT_IDS as readonly string[]).includes(product.id) &&
      IN_FORCE_STATUSES.has(product.status ?? "active"),
  );
}

/* Mirrors readUsageSummary in apps/v2/lib/plan.ts. The agent and the usage
   meter in the app must never disagree about how much is left. */
function summarize(customer: SupportCustomer): AccountSnapshot {
  const plan = activePlan(customer);
  const meter = plan
    ? customer.features?.[USAGE_FEATURE_ID]
    : customer.features?.[FREE_MESSAGES_FEATURE_ID];

  const unlimited = meter?.unlimited === true;
  const included =
    typeof meter?.included_usage === "number" && meter.included_usage > 0
      ? meter.included_usage
      : plan
        ? 0
        : FREE_MESSAGE_LIMIT;
  const balance =
    typeof meter?.balance === "number" ? Math.max(0, meter.balance) : included;
  const extra = customer.features?.[EXTRA_USAGE_FEATURE_ID];

  return {
    known: true,
    planId: plan ? plan.id : null,
    planName: plan?.name ?? "Free",
    planStatus: plan?.status ?? null,
    periodEndsAt: plan?.current_period_end ?? null,
    cancelsAtPeriodEnd: typeof plan?.canceled_at === "number",
    trialEndsAt: plan?.trial_ends_at ?? null,
    metering: plan ? "usage" : "messages",
    unlimited,
    remainingPct:
      !unlimited && included > 0
        ? Math.min(100, Math.max(0, (balance / included) * 100))
        : 100,
    freeMessagesRemaining: plan ? null : Math.floor(balance),
    freeMessagesIncluded: plan ? null : Math.floor(included),
    nextResetAt: typeof meter?.next_reset_at === "number" ? meter.next_reset_at : null,
    extraUsageBalance: typeof extra?.balance === "number" ? extra.balance : null,
  };
}


/* Absent row means the default, which is on. Memory itself is a paid
   feature, so "on" only does anything on a paid plan. */
export const memorySwitch = internalQuery({
  args: { externalId: v.string() },
  handler: async (ctx, { externalId }) => {
    const row = await ctx.db
      .query("memorySettings")
      .withIndex("by_user", (q) => q.eq("userId", externalId))
      .first();
    return row?.enabled ?? true;
  },
});

/**
 * Plan, allowance, and memory switch for one customer, keyed by their Clerk
 * user id (which is also their Autumn customer id).
 *
 * A customer Autumn has never seen comes back `known: false` rather than as a
 * fabricated free plan, so the agent says it can't see the account instead of
 * telling somebody they're on a plan they aren't.
 */
export const snapshot = action({
  args: { secret: v.string(), externalId: v.string() },
  handler: async (
    ctx,
    { secret, externalId },
  ): Promise<AccountSnapshot & { memoryEnabled: boolean }> => {
    assertSupportSecret(secret);
    if (!externalId.trim()) return { ...UNKNOWN, memoryEnabled: false };

    const secretKey = process.env.AUTUMN_SECRET_KEY;
    if (!secretKey) {
      throw new Error("Billing isn't configured (AUTUMN_SECRET_KEY).");
    }

    const [customer, memoryEnabled] = await Promise.all([
      new Autumn({ secretKey }).customers.get(externalId),
      ctx.runQuery(internal.support.account.memorySwitch, { externalId }),
    ]);
    if (customer.error || !customer.data) return { ...UNKNOWN, memoryEnabled };

    return { ...summarize(customer.data as SupportCustomer), memoryEnabled };
  },
});
