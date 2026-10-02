/**
 * Platinum: the premium line, and the gate in front of it.
 *
 * Platinum isn't always for sale. An admin flips availability from the console
 * (`platinumConfig`, a singleton). While it's open, /platinum checks out like
 * any other plan. While it's closed, the page collects interest instead — and
 * an admin approving a request mints a Stripe checkout link for that customer
 * and emails it to them.
 *
 * The entitlements themselves (5x/10x Mega's allowance, the unmetered Fast
 * tier, no premium on custom models) live in Autumn's product config and in
 * convex/inference/billing.ts. Nothing here grants anything — it only decides
 * who gets to reach the checkout.
 */

import { Autumn } from "autumn-js";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireAdmin } from "./admin";
import { sendEmail } from "./email";
import {
  platinumInviteHtml,
  platinumInviteSubject,
  platinumInviteText,
} from "./emails/platinumInvite";
import { PLATINUM_PRODUCT_IDS } from "./inference/billing";
import { siteUrl } from "./site";

// The Autumn product ids, as a validator. Kept literal rather than derived from
// PLATINUM_PRODUCT_IDS because Convex validators need the shape at build time.
const platinumPlanValidator = v.union(
  v.literal("platinum"),
  v.literal("platinum_max"),
);
export type PlatinumPlan = "platinum" | "platinum_max";

/** Display names, used by the console table and the invite email. */
export const PLATINUM_PLAN_NAMES: Record<PlatinumPlan, string> = {
  platinum: "Platinum",
  platinum_max: "Platinum Max",
};

// Where Stripe returns people after a successful Platinum checkout, at the
// origin convex/site.ts resolves.
const SITE_URL = siteUrl();
const CHECKOUT_SUCCESS_URL = `${SITE_URL}/platinum`;
// Mail clients can't resolve a relative src, so the mark ships as an absolute
// URL into the same public asset the site serves.
const EMAIL_LOGO_URL = `${SITE_URL}/whirl-mark.png`;

function planName(plan: string): string {
  return PLATINUM_PLAN_NAMES[plan as PlatinumPlan] ?? "Platinum";
}

// --- Availability -----------------------------------------------------------

async function readOpen(ctx: QueryCtx): Promise<boolean> {
  const config = await ctx.db.query("platinumConfig").first();
  // No row yet means nobody has opened it. Closed is the safe default: a
  // Platinum sale we didn't mean to make is far worse than a missed one.
  return config?.open === true;
}

/** Public: drives whether /platinum offers checkout or collects interest. */
export const availability = query({
  args: {},
  handler: async (ctx): Promise<{ open: boolean }> => {
    return { open: await readOpen(ctx) };
  },
});

/** Admin: flip Platinum open or closed for everyone. */
export const setAvailability = mutation({
  args: { open: v.boolean() },
  handler: async (ctx, { open }) => {
    await requireAdmin(ctx);
    const existing = await ctx.db.query("platinumConfig").first();
    if (existing) {
      await ctx.db.patch(existing._id, { open, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("platinumConfig", { open, updatedAt: Date.now() });
    }
    return null;
  },
});

// --- Expressing interest ----------------------------------------------------

/** What the signed-in user's own page needs to know about their request. */
export type MyInterest = {
  plan: PlatinumPlan;
  status: "pending" | "approved" | "declined";
  createdAt: number;
  /** Present once approved — the page can offer the link directly too. */
  checkoutUrl: string | null;
};

export const myInterest = query({
  args: {},
  handler: async (ctx): Promise<MyInterest | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("platinumInterest")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .first();
    if (!row) return null;
    return {
      plan: row.plan as PlatinumPlan,
      status: row.status,
      createdAt: row.createdAt,
      // A declined request keeps its old link out of the user's hands.
      checkoutUrl: row.status === "approved" ? (row.checkoutUrl ?? null) : null,
    };
  },
});

/**
 * Register (or update) interest in Platinum. One row per user — asking again
 * for the other tier edits the existing request rather than queueing a second,
 * and re-asking after a decision puts them back in the pending queue.
 *
 * Deliberately takes nothing but the tier. We don't ask why someone wants
 * Platinum: the answer was never going to decide the approval, and asking a
 * customer to justify a $100/month purchase is a bad first impression.
 */
export const expressInterest = mutation({
  args: { plan: platinumPlanValidator },
  handler: async (ctx, { plan }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Sign in to request Platinum.");
    }
    const email = identity.email;
    if (!email) {
      throw new ConvexError(
        "Your account has no email address, so we'd have nowhere to send the invite.",
      );
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("platinumInterest")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        plan,
        email,
        name: identity.name ?? undefined,
        // Re-asking reopens the request, and the old invite link stops being
        // theirs until an admin approves again.
        status: "pending",
        checkoutUrl: undefined,
        emailedAt: undefined,
        emailError: undefined,
        decidedAt: undefined,
        updatedAt: now,
      });
      return null;
    }

    await ctx.db.insert("platinumInterest", {
      userId: identity.subject,
      email,
      name: identity.name ?? undefined,
      plan,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return null;
  },
});

// --- Console: the request queue --------------------------------------------

export type InterestRow = {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  plan: PlatinumPlan;
  planName: string;
  status: "pending" | "approved" | "declined";
  checkoutUrl: string | null;
  emailedAt: number | null;
  emailError: string | null;
  createdAt: number;
};

function toInterestRow(doc: Doc<"platinumInterest">): InterestRow {
  return {
    id: doc._id,
    userId: doc.userId,
    email: doc.email,
    name: doc.name ?? null,
    plan: doc.plan as PlatinumPlan,
    planName: planName(doc.plan),
    status: doc.status,
    checkoutUrl: doc.checkoutUrl ?? null,
    emailedAt: doc.emailedAt ?? null,
    emailError: doc.emailError ?? null,
    createdAt: doc.createdAt,
  };
}

// Enough to see the whole queue at a glance without an unbounded read; the
// console shows a "showing the newest N" note when it fills up.
const INTEREST_PAGE_SIZE = 100;

/** Admin: the interest queue, newest first, optionally filtered by status. */
export const listInterest = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("declined"),
      ),
    ),
  },
  handler: async (ctx, { status }): Promise<InterestRow[]> => {
    await requireAdmin(ctx);
    const rows = status
      ? await ctx.db
          .query("platinumInterest")
          .withIndex("by_status", (q) => q.eq("status", status))
          .order("desc")
          .take(INTEREST_PAGE_SIZE)
      : await ctx.db
          .query("platinumInterest")
          .order("desc")
          .take(INTEREST_PAGE_SIZE);
    return rows.map(toInterestRow);
  },
});

/** Internal: the row an approval action is working on. */
export const getInterest = internalQuery({
  args: { id: v.id("platinumInterest") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

/** Internal: record the outcome of an approval attempt. */
export const recordDecision = internalMutation({
  args: {
    id: v.id("platinumInterest"),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
    ),
    checkoutUrl: v.optional(v.string()),
    emailedAt: v.optional(v.number()),
    emailError: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, checkoutUrl, emailedAt, emailError }) => {
    const now = Date.now();
    await ctx.db.patch(id, {
      status,
      checkoutUrl,
      emailedAt,
      emailError,
      decidedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

/** Admin: turn a request down. Keeps the row so it doesn't get re-triaged. */
export const declineInterest = mutation({
  args: { id: v.id("platinumInterest") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(id);
    if (!row) throw new ConvexError("That request no longer exists.");
    await ctx.db.patch(id, {
      status: "declined",
      // Revoke any link a previous approval handed out.
      checkoutUrl: undefined,
      decidedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Admin: approve a request — mint a Stripe checkout session for that customer
 * and email them the link.
 *
 * `force_checkout` is what makes this work at all: without it Autumn would
 * quietly attach the product to a customer who already has a card on file,
 * charging them without ever showing them a price. An invite has to be
 * something the person opts into, so we always want a real checkout page.
 *
 * The two halves fail independently and that's on purpose. If checkout can't
 * be minted, nothing changes and the admin sees why. If the link is minted but
 * the email bounces, the approval still lands — with the link and the mail
 * error stored on the row, so the console can show it and offer a retry rather
 * than losing a live checkout session.
 */
export const approveInterest = action({
  args: { id: v.id("platinumInterest") },
  handler: async (
    ctx,
    { id },
  ): Promise<{ emailed: boolean; checkoutUrl: string; error?: string }> => {
    await requireAdmin(ctx);

    const row = await ctx.runQuery(internal.platinum.getInterest, { id });
    if (!row) throw new ConvexError("That request no longer exists.");
    if (!(PLATINUM_PRODUCT_IDS as readonly string[]).includes(row.plan)) {
      throw new ConvexError(`"${row.plan}" isn't a Platinum plan.`);
    }

    const secretKey = process.env.AUTUMN_SECRET_KEY;
    if (!secretKey) {
      throw new ConvexError("Billing isn't configured (AUTUMN_SECRET_KEY).");
    }
    const autumn = new Autumn({ secretKey });

    const { data, error } = await autumn.checkout({
      customer_id: row.userId,
      product_id: row.plan,
      force_checkout: true,
      success_url: CHECKOUT_SUCCESS_URL,
      // Lets Autumn fill in a customer who has never reached billing before.
      customer_data: { email: row.email, name: row.name ?? null },
    });
    if (error || !data?.url) {
      throw new ConvexError(
        `Couldn't create a checkout link: ${error?.message ?? "Autumn returned no URL."}`,
      );
    }
    const checkoutUrl = data.url;

    const name = planName(row.plan);
    const sent = await sendEmail({
      to: row.email,
      subject: platinumInviteSubject(name),
      html: platinumInviteHtml({
        planName: name,
        checkoutUrl,
        name: row.name,
        logoUrl: EMAIL_LOGO_URL,
      }),
      text: platinumInviteText({
        planName: name,
        checkoutUrl,
        name: row.name,
      }),
    });

    await ctx.runMutation(internal.platinum.recordDecision, {
      id,
      status: "approved",
      checkoutUrl,
      emailedAt: sent.ok ? Date.now() : undefined,
      emailError: sent.ok ? undefined : sent.error,
    });

    return sent.ok
      ? { emailed: true, checkoutUrl }
      : { emailed: false, checkoutUrl, error: sent.error };
  },
});
