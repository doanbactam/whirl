import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { currentSlotPlan, eligible, PERKS } from "./slots/catalog";
import {
  grantPlan,
  readSlotCustomer,
  slotBillingClient,
  UnconfirmedPlanGrant,
} from "./slots/billing";
import { guestOwner, newRedemptionCode } from "./slots/guest";

export const play = action({
  args: {
    requestId: v.string(),
    revision: v.number(),
    sku: v.optional(v.string()),
    expectedPrice: v.optional(v.number()),
    guestKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<"slotPlays">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      const owner = guestOwner(args.guestKey);
      return ctx.runMutation(internal.slots.playInternal, {
        requestId: args.requestId,
        revision: args.revision,
        ...(args.sku
          ? { sku: args.sku, expectedPrice: args.expectedPrice }
          : {}),
        owner,
        customerId: owner,
        plan: "free",
        redemptionCode: newRedemptionCode(),
      });
    }
    const customer = await readSlotCustomer(
      slotBillingClient(),
      identity.subject,
    );
    return ctx.runMutation(internal.slots.playInternal, {
      requestId: args.requestId,
      revision: args.revision,
      ...(args.sku ? { sku: args.sku, expectedPrice: args.expectedPrice } : {}),
      owner: identity.tokenIdentifier,
      customerId: identity.subject,
      plan: currentSlotPlan(customer),
    });
  },
});

export const activate = action({
  args: { prizeId: v.id("slotPrizes") },
  handler: async (ctx, { prizeId }): Promise<null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to activate your prize.");
    const customer = await readSlotCustomer(
      slotBillingClient(),
      identity.subject,
    );
    return ctx.runMutation(internal.slotRewards.beginInternal, {
      prizeId,
      owner: identity.tokenIdentifier,
      plan: currentSlotPlan(customer),
    });
  },
});

export const fulfill = internalAction({
  args: { prizeId: v.id("slotPrizes") },
  handler: async (ctx, { prizeId }) => {
    const prize = await ctx.runQuery(internal.slotRewards.getInternal, {
      prizeId,
    });
    if (!prize || prize.status !== "activating") return null;
    const perk = PERKS.find((p) => p.id === prize.sku)!;
    try {
      const autumn = slotBillingClient();
      const customer = await readSlotCustomer(autumn, prize.customerId);
      const plan = currentSlotPlan(customer);
      if (!eligible(perk, plan) || (perk.kind === "plan" && plan !== "free"))
        throw new ConvexError(
          "Your plan changed. This prize is saved until your account is eligible again.",
        );
      if (perk.kind === "plan") {
        await grantPlan(prize.customerId, perk.plan!, prize.expiresAt!);
      } else {
        const featureId = perk.kind === "messages" ? "messages" : "extra_usage";
        if (!customer.features[featureId]) {
          // A paid customer may never have bought extra usage. Create its first
          // balance rather than silently tracking against a nonexistent bucket.
          // Unlike track, create has no idempotency key; an ambiguous response
          // goes to review and the watchdog knows not to replay it either.
          await ctx.runMutation(internal.slotRewards.markBalanceCreation, {
            prizeId,
          });
          try {
            const { error } = await autumn.balances.create({
              customer_id: prize.customerId,
              feature_id: featureId,
              granted_balance: perk.amount!,
            });
            if (error) throw new Error("Unconfirmed balance grant");
          } catch {
            throw new UnconfirmedPlanGrant(
              "Billing did not confirm your reward balance. Contact support with your prize ID; your prize is saved.",
            );
          }
        } else {
          const { error } = await autumn.track({
            customer_id: prize.customerId,
            feature_id: featureId,
            value: -perk.amount!,
            idempotency_key: `slot-prize:${prizeId}`,
          });
          if (error)
            throw new ConvexError(
              "We couldn’t add your reward balance. Your prize is saved; please try again.",
            );
        }
      }
    } catch (error) {
      await ctx.runMutation(internal.slotRewards.finishInternal, {
        prizeId,
        status: error instanceof UnconfirmedPlanGrant ? "review" : "ready",
        error:
          error instanceof ConvexError || error instanceof UnconfirmedPlanGrant
            ? String(error instanceof ConvexError ? error.data : error.message)
            : "Activation could not finish. Your prize is saved; please try again.",
      });
      return null;
    }
    // Keep this outside the provider catch: losing the receipt must not make a
    // successful, non-idempotent plan grant retryable. Recovery marks it review.
    await ctx.runMutation(internal.slotRewards.finishInternal, {
      prizeId,
      status: "active",
    });
    return null;
  },
});
