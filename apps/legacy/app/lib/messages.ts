// Free plan metering. Free customers get a small allowance of `messages`
// (a count-based Autumn feature) instead of the USD `usage` pool that paid
// plans draw from. This helper reads the customer's `messages` entitlement
// and whether they're still on the free plan, so the UI can show how many
// free messages remain and nudge an upgrade.

// Fallback used only when Autumn hasn't reported an `included_usage` yet.
// The source of truth is the Autumn free-plan config.
export const FREE_MESSAGE_LIMIT = 15;

// The paid plans, cheapest to priciest. Mirrors PAID_PRODUCT_IDS in
// convex/inference/billing.ts and convex/admin.ts — keep the three in sync.
export const PAID_PLAN_IDS = ["mini", "turbo", "mega"] as const;

// Statuses that mean a plan is currently in force. `past_due` counts so a
// lapsed-payment customer still reads as their plan (surfaced with a "Past due"
// label) rather than silently dropping to Free.
const IN_FORCE_PLAN_STATUSES = new Set(["active", "trialing", "past_due"]);

type PlanProductLike = {
  id: string;
  status?: string | null;
  is_add_on?: boolean;
};

/**
 * The customer's active paid plan product, or `undefined` when they're on Free.
 *
 * Autumn always carries a default `free` product — and may carry one-off add-ons
 * like extra-usage — alongside any subscribed plan, all reported with an
 * "active" status. Naively grabbing the *first* active product can therefore
 * surface the default free product (e.g. right after a plan change, when it
 * sorts ahead of the freshly-attached plan) and make a paying customer look
 * free. Restrict to the known paid plans, mirroring derivePlan in
 * convex/admin.ts so the client and server agree on a customer's plan.
 */
export function findActivePlanProduct<T extends PlanProductLike>(
  products: readonly T[] | undefined,
): T | undefined {
  return products?.find(
    (p) =>
      !p.is_add_on &&
      (PAID_PLAN_IDS as readonly string[]).includes(p.id) &&
      IN_FORCE_PLAN_STATUSES.has(p.status ?? "active"),
  );
}

type CustomerFeatureLike = {
  balance?: number | null;
  included_usage?: number | null;
  unlimited?: boolean | null;
};

type CustomerLike =
  | {
      products?: readonly { id: string; status?: string | null }[];
      features?: Record<string, CustomerFeatureLike>;
    }
  | null
  | undefined;

export type FreeMessages = {
  /** True when the customer is on the free plan (no active paid product). */
  isFree: boolean;
  /** Messages left in the current allowance. */
  remaining: number;
  /** Total messages granted this period (defaults to FREE_MESSAGE_LIMIT). */
  included: number;
  /** Messages already spent this period. */
  used: number;
};

export function readFreeMessages(customer: CustomerLike): FreeMessages {
  const isFree = !findActivePlanProduct(customer?.products);

  const feature = customer?.features?.messages;
  const included =
    typeof feature?.included_usage === "number" && feature.included_usage > 0
      ? feature.included_usage
      : FREE_MESSAGE_LIMIT;
  const remaining =
    typeof feature?.balance === "number"
      ? Math.max(0, feature.balance)
      : included;
  const used = Math.max(0, included - remaining);

  return { isFree, remaining, included, used };
}
