import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { eligible, PERKS, perkExpiry } from "./slots/catalog";
import { prizeStatus, slotPlan } from "./slots/tables";
import { requireAdmin } from "./admin";
import { mutation } from "./_generated/server";

export const getInternal = internalQuery({
  args: { prizeId: v.id("slotPrizes") },
  handler: (ctx, { prizeId }) => ctx.db.get(prizeId),
});

export const markBalanceCreation = internalMutation({
  args: { prizeId: v.id("slotPrizes") },
  handler: async (ctx, { prizeId }) => {
    const prize = await ctx.db.get(prizeId);
    if (!prize || prize.status !== "activating")
      throw new ConvexError("This reward is no longer being activated.");
    await ctx.db.patch(prizeId, { balanceCreation: true });
    return null;
  },
});

export const beginInternal = internalMutation({
  args: { prizeId: v.id("slotPrizes"), owner: v.string(), plan: slotPlan },
  handler: async (ctx, { prizeId, owner, plan }) => {
    const prize = await ctx.db.get(prizeId);
    if (!prize || prize.owner !== owner)
      throw new ConvexError("This prize does not belong to your account.");
    if (prize.status === "active") return null;
    const perk = PERKS.find((p) => p.id === prize.sku)!;
    if (prize.status === "review")
      throw new ConvexError(
        "This activation needs a billing check. Contact support with your prize ID; your prize is saved.",
      );
    if (prize.status === "activating")
      throw new ConvexError(
        "Your perk is being activated. Check back shortly.",
      );
    if (!eligible(perk, plan))
      throw new ConvexError(
        "This perk is not available for your current plan. It will stay in your inventory.",
      );
    if (perk.kind === "plan" && plan !== "free")
      throw new ConvexError(
        "You already have a paid plan. Save this pass until it ends, then activate it here.",
      );
    const wallet = await ctx.db
      .query("slotWallets")
      .withIndex("by_owner", (q) => q.eq("owner", owner))
      .unique();
    if (!wallet)
      throw new ConvexError(
        "Your prize wallet could not be found. Contact support.",
      );
    if (wallet.activationId)
      throw new ConvexError(
        "Another perk is being activated. Please wait for it to finish.",
      );
    const now = Date.now();
    if (perk.kind === "image") {
      const expiresAt = perkExpiry(
        perk,
        Math.max(now, wallet.imageUntil ?? 0),
      )!;
      await ctx.db.patch(wallet._id, { imageUntil: expiresAt });
      await ctx.db.patch(prizeId, {
        status: "active",
        startsAt: now,
        expiresAt,
        error: undefined,
      });
      await ctx.scheduler.runAt(expiresAt, internal.slotRewards.expireImage, {
        walletId: wallet._id,
        expiresAt,
      });
      return null;
    }
    await ctx.db.patch(wallet._id, { activationId: prizeId });
    await ctx.db.patch(prizeId, {
      status: "activating",
      startsAt: now,
      expiresAt: perkExpiry(perk, now),
      error: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.slotActions.fulfill, { prizeId });
    // A killed action must not leave an eternal spinner or silently replay a plan grant.
    await ctx.scheduler.runAfter(120_000, internal.slotRewards.recover, {
      prizeId,
      startsAt: now,
    });
    return null;
  },
});

export const finishInternal = internalMutation({
  args: {
    prizeId: v.id("slotPrizes"),
    status: prizeStatus,
    error: v.optional(v.string()),
  },
  handler: async (ctx, { prizeId, status, error }) => {
    const prize = await ctx.db.get(prizeId);
    if (!prize || prize.status === "active") return null;
    await ctx.db.patch(prizeId, { status, error });
    const wallet = await ctx.db
      .query("slotWallets")
      .withIndex("by_owner", (q) => q.eq("owner", prize.owner))
      .unique();
    if (wallet?.activationId === prizeId)
      await ctx.db.patch(wallet._id, { activationId: undefined });
    return null;
  },
});

export const recover = internalMutation({
  args: { prizeId: v.id("slotPrizes"), startsAt: v.number() },
  handler: async (ctx, { prizeId, startsAt }) => {
    const prize = await ctx.db.get(prizeId);
    if (!prize || prize.status !== "activating" || prize.startsAt !== startsAt)
      return null;
    const needsReview =
      PERKS.find((p) => p.id === prize.sku)?.kind === "plan" ||
      prize.balanceCreation;
    await ctx.db.patch(prizeId, {
      status: needsReview ? "review" : "ready",
      error: needsReview
        ? "Billing did not confirm this reward. Contact support with your prize ID so we can check it safely."
        : "Activation timed out. Try again; your credit grant cannot be applied twice.",
    });
    const wallet = await ctx.db
      .query("slotWallets")
      .withIndex("by_owner", (q) => q.eq("owner", prize.owner))
      .unique();
    if (wallet?.activationId === prizeId)
      await ctx.db.patch(wallet._id, { activationId: undefined });
    return null;
  },
});

export const expireImage = internalMutation({
  args: { walletId: v.id("slotWallets"), expiresAt: v.number() },
  handler: async (ctx, { walletId, expiresAt }) => {
    const wallet = await ctx.db.get(walletId);
    if (wallet?.imageUntil === expiresAt && expiresAt <= Date.now())
      await ctx.db.patch(walletId, { imageUntil: undefined });
    return null;
  },
});

/** Support can reconcile an ambiguous provider response after checking Autumn. */
export const reconcile = mutation({
  args: { prizeId: v.id("slotPrizes"), delivered: v.boolean() },
  handler: async (ctx, { prizeId, delivered }) => {
    await requireAdmin(ctx);
    const prize = await ctx.db.get(prizeId);
    if (!prize || prize.status !== "review")
      throw new ConvexError(
        "Only prizes awaiting a billing check can be reconciled.",
      );
    await ctx.db.patch(prizeId, {
      status: delivered ? "active" : "ready",
      error: undefined,
    });
    return null;
  },
});
