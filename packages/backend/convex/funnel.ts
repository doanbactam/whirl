// The acquisition funnel, server side (W-155).
//
// Six ordered steps describe a person's whole journey through Whirl:
//
//   visitor_landed → signup_completed → first_chat_sent → free_limit_reached
//     → paywall_viewed → plan_purchased
//
// Three of them are emitted by the browser (apps/v2/lib/funnel.ts) because they
// are things a person *sees*. The other three live here, because only the
// server knows whether they actually happened: a chat that really reached the
// database, a gate that really denied a turn, a plan Autumn really confirms.
//
// Every step here is once-per-user by nature, so each one is guarded by a row
// in `funnelMilestones` — the same milestone can be claimed from several places
// (a tab reloading, a retried turn, two devices) and still only bill PostHog
// once. `repeat` opts an event out of that: the free ceiling is a wall people
// bounce off more than once, so it fires every time and carries `first_time`.
//
// Nothing in this file may ever break the thing that triggered it. The DB write
// is transactional; the PostHog capture happens in a scheduled action, so a slow
// or failing analytics host can't sit on a send.

import { Autumn } from "autumn-js";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  fetchBillingCustomer,
  PAID_PRODUCT_IDS,
  snapshotIsPaid,
} from "./inference/billing";
import { captureServerEvent } from "./posthog";

/**
 * Funnel event names. The browser half of this list lives in
 * `apps/v2/lib/posthog.ts` — keep the two in sync; PostHog stitches them
 * together by distinct id (the Clerk subject, which is also what
 * `posthog.identify()` sends).
 */
export const FUNNEL_EVENTS = {
  signupCompleted: "signup_completed",
  firstChatSent: "first_chat_sent",
  freeLimitReached: "free_limit_reached",
  planPurchased: "plan_purchased",
} as const;

/** The once-per-user stations recorded in `funnelMilestones`. */
export const FUNNEL_MILESTONES = ["first_chat", "free_limit", "paid"] as const;

export type FunnelMilestone = (typeof FUNNEL_MILESTONES)[number];

const milestoneValidator = v.union(
  v.literal("first_chat"),
  v.literal("free_limit"),
  v.literal("paid"),
);

const MILESTONE_EVENTS: Record<FunnelMilestone, string> = {
  first_chat: FUNNEL_EVENTS.firstChatSent,
  free_limit: FUNNEL_EVENTS.freeLimitReached,
  paid: FUNNEL_EVENTS.planPurchased,
};

async function readMilestones(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<{ id: Id<"funnelMilestones"> | null; reached: string[] }> {
  const row = await ctx.db
    .query("funnelMilestones")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return { id: row?._id ?? null, reached: row?.reached ?? [] };
}

/**
 * Record that `userId` reached `milestone` and, when that's news, hand the
 * matching event to PostHog. Returns whether this was the first time.
 *
 * `repeat` keeps emitting on later claims too — for steps that are genuinely
 * recurring, like walking into the free-message ceiling again next month. The
 * event always carries `first_time` so both readings stay available.
 */
export const reachMilestone = internalMutation({
  args: {
    userId: v.string(),
    milestone: milestoneValidator,
    properties: v.optional(v.record(v.string(), v.any())),
    repeat: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, milestone, properties, repeat }) => {
    const { id, reached } = await readMilestones(ctx, userId);
    const firstTime = !reached.includes(milestone);

    if (firstTime) {
      const now = Date.now();
      if (id) {
        await ctx.db.patch(id, {
          reached: [...reached, milestone],
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("funnelMilestones", {
          userId,
          reached: [milestone],
          updatedAt: now,
        });
      }
    }

    if (firstTime || repeat === true) {
      await ctx.scheduler.runAfter(0, internal.funnel.emit, {
        event: MILESTONE_EVENTS[milestone],
        distinctId: userId,
        properties: { ...properties, first_time: firstTime },
      });
    }

    return firstTime;
  },
});

/**
 * Hand one event to PostHog from its own scheduled slot, so the HTTP round trip
 * never rides inside the mutation (or the send) that produced it.
 */
export const emit = internalAction({
  args: {
    event: v.string(),
    distinctId: v.string(),
    properties: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (_ctx, { event, distinctId, properties }) => {
    await captureServerEvent({ event, distinctId, properties });
    return null;
  },
});

/**
 * The last step, claimed by the client: it has just seen an in-force paid
 * product on the Autumn customer (after a Stripe return, or an in-app plan
 * switch). We don't take its word for it — the claim only schedules a
 * confirmation that re-reads the customer server side. Called on load by paying
 * users, so it exits early once the milestone is already on the row.
 */
export const recordPaidPlan = mutation({
  args: { planId: v.string() },
  handler: async (ctx, { planId }) => {
    const identity = await ctx.auth.getUserIdentity();
    // A signed-out claim can't name a person; nothing to record, nothing to say.
    if (!identity) return null;
    if (!(PAID_PRODUCT_IDS as readonly string[]).includes(planId)) return null;

    const { reached } = await readMilestones(ctx, identity.subject);
    if (reached.includes("paid")) return null;

    await ctx.scheduler.runAfter(0, internal.funnel.confirmPaidPlan, {
      userId: identity.subject,
      planId,
    });
    return null;
  },
});

/**
 * Verify a paid-plan claim against Autumn before it becomes revenue in PostHog.
 * A customer who reads as free here simply doesn't count — the claim is dropped
 * without marking the milestone, so a later, real payment still lands.
 */
export const confirmPaidPlan = internalAction({
  args: { userId: v.string(), planId: v.string() },
  handler: async (ctx, { userId, planId }) => {
    const secretKey = process.env.AUTUMN_SECRET_KEY;
    if (!secretKey) return null;

    const autumn = new Autumn({ secretKey });
    const customer = await fetchBillingCustomer({ autumn, customerId: userId });
    if (!customer || !snapshotIsPaid(customer)) return null;

    await ctx.runMutation(internal.funnel.reachMilestone, {
      userId,
      milestone: "paid",
      properties: { plan: planId },
    });
    return null;
  },
});
