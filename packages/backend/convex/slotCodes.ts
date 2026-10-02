import { ConvexError, v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  currentSlotPlan,
  eligible,
  PERKS,
  STARTING_TOKENS,
} from "./slots/catalog";
import { readSlotCustomer, slotBillingClient } from "./slots/billing";
import { slotPlan } from "./slots/tables";
import { guestOwner, normalizeRedemptionCode } from "./slots/guest";

/** Available even after sign-in so the browser's guest codes are not hidden. */
export const guestPrizes = query({
  args: { guestKey: v.string() },
  handler: async (ctx, { guestKey }) =>
    ctx.db
      .query("slotPrizes")
      .withIndex("by_owner_and_status", (q) =>
        q.eq("owner", guestOwner(guestKey)).eq("status", "ready"),
      )
      .order("desc")
      .take(100),
});

type RedemptionResult =
  | { ok: true; prizeId: Id<"slotPrizes">; name: string }
  | { ok: false; message: string };

export const redeem = action({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<RedemptionResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to redeem an arcade perk.");
    const normalized = normalizeRedemptionCode(code);
    const customer = await readSlotCustomer(
      slotBillingClient(),
      identity.subject,
    );
    return ctx.runMutation(internal.slotCodes.redeemInternal, {
      code: normalized,
      plan: currentSlotPlan(customer),
    });
  },
});

export const redeemInternal = internalMutation({
  args: { code: v.string(), plan: slotPlan },
  handler: async (ctx, { code, plan }): Promise<RedemptionResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to redeem an arcade perk.");
    const normalized = normalizeRedemptionCode(code);
    const owner = identity.tokenIdentifier;
    let wallet = await ctx.db
      .query("slotWallets")
      .withIndex("by_owner", (q) => q.eq("owner", owner))
      .unique();
    if (!wallet) {
      const id = await ctx.db.insert("slotWallets", {
        owner,
        customerId: identity.subject,
        tokens: STARTING_TOKENS,
        revision: 0,
        spins: 0,
      });
      wallet = (await ctx.db.get(id))!;
    }
    if (wallet.lastRedeemAt && Date.now() - wallet.lastRedeemAt < 2_000)
      return {
        ok: false as const,
        message: "Please wait a moment before trying another code.",
      };
    await ctx.db.patch(wallet._id, { lastRedeemAt: Date.now() });
    const prize = await ctx.db
      .query("slotPrizes")
      .withIndex("by_redemptionCode", (q) => q.eq("redemptionCode", normalized))
      .unique();
    // Return errors rather than throw so unsuccessful attempts keep their rate limit.
    if (!prize)
      return {
        ok: false as const,
        message:
          "That code wasn’t found. Check the code in your prize tray and try again.",
      };
    if (prize.redeemedBy && prize.redeemedBy !== owner)
      return {
        ok: false as const,
        message: "This code has already been redeemed.",
      };
    const perk = PERKS.find((perk) => perk.id === prize.sku)!;
    if (!prize.redeemedBy) {
      if (!prize.owner.startsWith("guest:") || prize.status !== "ready")
        return {
          ok: false as const,
          message: "This code is not available to redeem.",
        };
      if (!eligible(perk, plan))
        return {
          ok: false,
          message:
            "This perk is not available for your current plan. The code has not been redeemed.",
        };
      // Ownership transfers atomically. Stock was reserved when the guest won;
      // redemption neither consumes another unit nor grants another perk.
      await ctx.db.patch(prize._id, {
        owner,
        customerId: identity.subject,
        redeemedBy: owner,
      });
    }
    return {
      ok: true as const,
      prizeId: prize._id,
      name: perk.name,
    };
  },
});
