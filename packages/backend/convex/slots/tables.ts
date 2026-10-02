import { defineTable } from "convex/server";
import { v } from "convex/values";

export const slotPlan = v.union(
  v.literal("free"),
  v.literal("mini"),
  v.literal("turbo"),
  v.literal("mega"),
  v.literal("platinum"),
  v.literal("platinum_max"),
);

export const prizeStatus = v.union(
  v.literal("ready"),
  v.literal("activating"),
  v.literal("active"),
  v.literal("review"),
);
export const slotTables = {
  slotWallets: defineTable({
    owner: v.string(),
    customerId: v.string(),
    tokens: v.number(),
    revision: v.number(),
    spins: v.number(),
    lastSpinAt: v.optional(v.number()),
    imageUntil: v.optional(v.number()),
    activationId: v.optional(v.id("slotPrizes")),
    lastRedeemAt: v.optional(v.number()),
  })
    .index("by_owner", ["owner"])
    .index("by_customerId", ["customerId"]),
  slotStock: defineTable({ sku: v.string(), claimed: v.number() }).index(
    "by_sku",
    ["sku"],
  ),
  slotPlays: defineTable({
    owner: v.string(),
    requestId: v.string(),
    type: v.union(v.literal("spin"), v.literal("shop")),
    reels: v.array(v.string()),
    payout: v.number(),
    spent: v.number(),
    balance: v.number(),
    label: v.string(),
    sku: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_owner", ["owner"])
    .index("by_owner_and_requestId", ["owner", "requestId"]),
  slotPrizes: defineTable({
    owner: v.string(),
    customerId: v.string(),
    sku: v.string(),
    source: v.union(v.literal("spin"), v.literal("shop")),
    status: prizeStatus,
    createdAt: v.number(),
    startsAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    error: v.optional(v.string()),
    redemptionCode: v.optional(v.string()),
    redeemedBy: v.optional(v.string()),
    balanceCreation: v.optional(v.boolean()),
  })
    .index("by_owner", ["owner"])
    .index("by_owner_and_status", ["owner", "status"])
    .index("by_redemptionCode", ["redemptionCode"]),
};
