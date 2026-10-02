import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
  choosePerk,
  eligible,
  PERKS,
  perkPrice,
  resolveSpin,
  SPIN_COOLDOWN_MS,
  SPIN_COST,
  STARTING_TOKENS,
} from "./slots/catalog";
import type { Perk } from "./slots/catalog";
import { guestOwner } from "./slots/guest";
import { slotPlan } from "./slots/tables";

async function walletFor(ctx: MutationCtx, owner: string, customerId: string) {
  const existing = await ctx.db
    .query("slotWallets")
    .withIndex("by_owner", (q) => q.eq("owner", owner))
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert("slotWallets", {
    owner,
    customerId,
    tokens: STARTING_TOKENS,
    revision: 0,
    spins: 0,
  });
  return (await ctx.db.get(id))!;
}

async function stockFor(ctx: MutationCtx, sku: string) {
  return ctx.db
    .query("slotStock")
    .withIndex("by_sku", (q) => q.eq("sku", sku))
    .unique();
}

async function reserve(
  ctx: MutationCtx,
  perk: Perk,
  owner: string,
  customerId: string,
  source: "spin" | "shop",
  redemptionCode?: string,
) {
  const stock = await stockFor(ctx, perk.id);
  if ((stock?.claimed ?? 0) >= perk.stock)
    throw new ConvexError(
      "That perk just sold out. Your tokens have not been spent.",
    );
  if (stock) await ctx.db.patch(stock._id, { claimed: stock.claimed + 1 });
  else await ctx.db.insert("slotStock", { sku: perk.id, claimed: 1 });
  await ctx.db.insert("slotPrizes", {
    owner,
    customerId,
    sku: perk.id,
    source,
    status: "ready",
    createdAt: Date.now(),
    ...(redemptionCode ? { redemptionCode } : {}),
  });
}

export const shop = query({
  args: {},
  handler: async (ctx) =>
    Promise.all(
      PERKS.map(async (perk) => {
        const stock = await ctx.db
          .query("slotStock")
          .withIndex("by_sku", (q) => q.eq("sku", perk.id))
          .unique();
        return {
          ...perk,
          remaining: Math.max(0, perk.stock - (stock?.claimed ?? 0)),
        };
      }),
    ),
});

export const account = query({
  args: { guestKey: v.optional(v.string()) },
  handler: async (ctx, { guestKey }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity && !guestKey) return null;
    const owner = identity?.tokenIdentifier ?? guestOwner(guestKey);
    const [wallet, history, prizes] = await Promise.all([
      ctx.db
        .query("slotWallets")
        .withIndex("by_owner", (q) => q.eq("owner", owner))
        .unique(),
      ctx.db
        .query("slotPlays")
        .withIndex("by_owner", (q) => q.eq("owner", owner))
        .order("desc")
        .take(20),
      // Global stock bounds total prizes; show ready items first, then recent receipts.
      Promise.all(
        ["ready", "activating", "review", "active"].map((status) =>
          ctx.db
            .query("slotPrizes")
            .withIndex("by_owner_and_status", (q) =>
              q
                .eq("owner", owner)
                .eq(
                  "status",
                  status as "ready" | "activating" | "review" | "active",
                ),
            )
            .order("desc")
            .take(100),
        ),
      ),
    ]);
    return {
      tokens: wallet?.tokens ?? STARTING_TOKENS,
      revision: wallet?.revision ?? 0,
      spins: wallet?.spins ?? 0,
      history,
      prizes: prizes.flat(),
    };
  },
});

export const imageAccess = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const wallet = await ctx.db
      .query("slotWallets")
      .withIndex("by_owner", (q) => q.eq("owner", identity.tokenIdentifier))
      .unique();
    return wallet?.imageUntil ?? null;
  },
});

export const imageAccessInternal = internalQuery({
  args: { customerId: v.string() },
  handler: async (ctx, { customerId }) => {
    const wallet = await ctx.db
      .query("slotWallets")
      .withIndex("by_customerId", (q) => q.eq("customerId", customerId))
      .unique();
    return (wallet?.imageUntil ?? 0) > Date.now();
  },
});

/** Debit, outcome, stock reservation, prize and receipt commit as one transaction. */
export const playInternal = internalMutation({
  args: {
    owner: v.string(),
    customerId: v.string(),
    plan: slotPlan,
    requestId: v.string(),
    revision: v.number(),
    sku: v.optional(v.string()),
    expectedPrice: v.optional(v.number()),
    redemptionCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.requestId.length < 8 || args.requestId.length > 100)
      throw new ConvexError("Invalid request. Refresh and try again.");
    const receipt = await ctx.db
      .query("slotPlays")
      .withIndex("by_owner_and_requestId", (q) =>
        q.eq("owner", args.owner).eq("requestId", args.requestId),
      )
      .unique();
    if (receipt) return receipt;
    const wallet = await walletFor(ctx, args.owner, args.customerId);
    if (wallet.revision !== args.revision)
      throw new ConvexError(
        "Your balance changed in another tab. Try again with the updated balance.",
      );
    const now = Date.now();
    const buying = args.sku !== undefined;
    let perk: Perk | undefined;
    let reels: string[] = [];
    let payout = 0;
    let spent = SPIN_COST;
    let label: string;
    if (buying) {
      perk = PERKS.find((p) => p.id === args.sku);
      if (!perk) throw new ConvexError("This perk is not in the shop.");
      if (!eligible(perk, args.plan))
        throw new ConvexError(
          "This perk is not available for your current plan.",
        );
      spent = perkPrice(perk, args.plan);
      if (args.expectedPrice !== spent)
        throw new ConvexError(
          "The price changed. Refresh the shop and try again.",
        );
      label = perk.name;
    } else {
      if (
        wallet.lastSpinAt !== undefined &&
        now - wallet.lastSpinAt < SPIN_COOLDOWN_MS
      )
        throw new ConvexError("Let the reels settle before spinning again.");
      const outcome = resolveSpin(
        Math.floor(Math.random() * 10_000),
        Math.floor(Math.random() * 5),
      );
      reels = outcome.reels;
      payout = outcome.payout;
      label = outcome.label;
      if (outcome.drop) {
        const available: Perk[] = [];
        for (const candidate of PERKS) {
          if (!eligible(candidate, args.plan)) continue;
          const stock = await stockFor(ctx, candidate.id);
          if ((stock?.claimed ?? 0) < candidate.stock)
            available.push(candidate);
        }
        perk = choosePerk(available, Math.random());
        label = perk
          ? `${perk.name} dropped!`
          : "The shelf is empty. Spin returned";
        if (!perk) payout = SPIN_COST;
      }
    }
    if (wallet.tokens < spent)
      throw new ConvexError(
        buying
          ? "You don’t have enough tokens for this perk."
          : "You need 10 tokens to spin. Your remaining perks are still yours.",
      );
    if (perk)
      await reserve(
        ctx,
        perk,
        args.owner,
        args.customerId,
        buying ? "shop" : "spin",
        args.redemptionCode,
      );
    const balance = wallet.tokens - spent + payout;
    await ctx.db.patch(wallet._id, {
      tokens: balance,
      revision: wallet.revision + 1,
      ...(!buying ? { spins: wallet.spins + 1, lastSpinAt: now } : {}),
    });
    const id = await ctx.db.insert("slotPlays", {
      owner: args.owner,
      requestId: args.requestId,
      type: buying ? "shop" : "spin",
      reels,
      payout,
      spent,
      balance,
      label,
      ...(perk ? { sku: perk.id } : {}),
      createdAt: now,
    });
    // Receipts stay bounded. Monotonic revisions reject replays after eviction too.
    const old = await ctx.db
      .query("slotPlays")
      .withIndex("by_owner", (q) => q.eq("owner", args.owner))
      .order("desc")
      .take(21);
    if (old.length > 20) await ctx.db.delete(old[20]._id);
    return (await ctx.db.get(id))!;
  },
});
