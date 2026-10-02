/* Extra Usage: a paid-only top-up bucket that's separate from the plan's
   included `usage` pool. Plan usage is always spent first; the purchased
   `extra_usage` balance only covers the overflow once the plan pool runs
   dry. Buying the one-off `extra_usage` product ($1 per credit) tops this
   bucket up.

   These ids mirror the Autumn config (and the backend constants in
   convex/inference/billing.ts); they're redefined here so the client bundle
   doesn't pull in server-only billing code. */

import { findActivePlanProduct, type CustomerLike } from "@/lib/plan";

export const EXTRA_USAGE_PRODUCT_ID = "extra_usage";
export const EXTRA_USAGE_FEATURE_ID = "extra_usage";

/** Quick-pick top-up amounts, in whole dollars (= quantity of the $1 unit). */
export const TOPUP_PRESETS = [5, 10, 20] as const;

/** Bounds for the custom top-up input, in whole dollars. */
export const MIN_TOPUP_USD = 5;
export const MAX_TOPUP_USD = 500;

type FeatureLike = {
  balance?: number | null;
  included_usage?: number | null;
  usage?: number | null;
  unlimited?: boolean | null;
};

export type ExtraUsage = {
  /** Only paid customers can buy or hold extra usage. */
  isPaid: boolean;
  /** Remaining purchased extra-usage credit, in USD. */
  balance: number;
  /** Total extra-usage credit ever granted (balance + used), in USD. */
  included: number;
  /** Extra-usage credit already spent, in USD. */
  used: number;
  /** True when the customer's plan is unlimited (extra usage is moot). */
  unlimited: boolean;
};

export function readExtraUsage(customer: CustomerLike): ExtraUsage {
  const isPaid = !!findActivePlanProduct(customer);
  const features = customer?.features as
    | Record<string, FeatureLike | undefined>
    | undefined;
  const feature = features?.[EXTRA_USAGE_FEATURE_ID];
  const usageFeature = features?.usage;
  const balance =
    typeof feature?.balance === "number" ? Math.max(0, feature.balance) : 0;

  // Autumn may report total granted (`included_usage`) and/or spent (`usage`).
  // Derive whichever is missing so a progress bar always has a denominator:
  // top-ups are cumulative, so total = balance + used when nothing else is
  // known.
  const includedRaw =
    typeof feature?.included_usage === "number" ? feature.included_usage : null;
  const usedRaw = typeof feature?.usage === "number" ? feature.usage : null;
  let included: number;
  let used: number;
  if (includedRaw != null && includedRaw > 0) {
    included = includedRaw;
    used =
      usedRaw != null ? Math.max(0, usedRaw) : Math.max(0, included - balance);
  } else if (usedRaw != null) {
    used = Math.max(0, usedRaw);
    included = balance + used;
  } else {
    used = 0;
    included = balance;
  }

  const unlimited = !!usageFeature?.unlimited;
  return { isPaid, balance, included, used, unlimited };
}

/** Clamp a (possibly garbage) custom amount to the allowed whole-dollar range. */
export function clampTopupAmount(amount: number): number {
  if (!Number.isFinite(amount)) return MIN_TOPUP_USD;
  const rounded = Math.round(amount);
  return Math.min(MAX_TOPUP_USD, Math.max(MIN_TOPUP_USD, rounded));
}
