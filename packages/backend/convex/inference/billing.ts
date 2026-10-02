import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Autumn, type Customer } from "autumn-js";

// Internal tier keys are persisted in the DB and wired into billing gates, so
// they never change even as the user-facing lineup does. Current labels (see
// app/data/models.ts): Fast=Free (free-only), Basic=Fast, Max=Heavy. The old
// `Pro` tier (Sonnet) is retired — legacy rows still carry the key (the schema
// validator keeps accepting it) but resolveModelKey folds it into Auto.
export const MODEL_IDS = {
  Auto: "openrouter/auto",
  Fast: "openai/gpt-5.4-nano",
  Basic: "moonshotai/kimi-k2.6",
  Max: "x-ai/grok-4.5",
  Image: "openai/gpt-image-2",
} as const;

export type ModelKey = keyof typeof MODEL_IDS;

// Which tiers accept raw binary file blocks (PDFs and friends) in the prompt.
// Mirrors each model's OpenRouter `input_modalities`: kimi-k2.6 and
// gpt-5.4-nano are text+image only, so documents reach them as text extracted
// at upload — a file block would hard-fail the request. Keep in sync with
// ATTACHMENT_LIMITS in app/lib/attachment-upload.ts.
export const MODEL_ACCEPTS_NATIVE_FILES: Record<ModelKey, boolean> = {
  Auto: true,
  Fast: false,
  Basic: false,
  Max: true,
  // Image takes pictures, not documents; it never builds file blocks anyway.
  Image: false,
};

// The Free model (the `Fast` key) belongs to the free tier alone — paid plans run Fast
// (`Basic`) and Heavy (`Max`) instead. A paid customer can still arrive with
// `Fast` persisted (an old thread, stale localStorage), so rather than gating
// them out we quietly route the request to their Fast tier.
export function effectiveModelKeyFor(
  modelKey: ModelKey,
  isPaid: boolean,
): ModelKey {
  return isPaid && modelKey === "Fast" ? "Basic" : modelKey;
}

// Web search deductions use the cost Exa reports per call (costDollars.total,
// USD) 1:1 against the shared `usage` pool, the same way AI deductions use the
// OpenRouter-reported cost.
export const MIN_USAGE_BALANCE_REQUIRED = 0.000001;

// Upper bound on the agentic loop when search is enabled. This gives the model
// room to chain multiple searches before responding.
export const SEARCH_MAX_STEPS = 10;

// Upper bound on the agentic loop whenever any tool is available. Sized for a
// real multi-integration errand run one call per step (several reads across
// two integrations plus a final write), with the LAST step always reserved by
// prepareStep for a tool-free final answer — so hitting this ceiling produces
// a reply, never a silent cut-off. Loop policy (toolPolicy.ts) breaks actual
// spirals by detecting repeated identical calls long before this bound.
export const TOOL_MAX_STEPS = 16;

// Sentinel content the client parses to know an assistant message failed
// because of a billing gate (instead of a model/network error). Format:
// `__AUTUMN_GATE__:<feature_id>`.
export const GATE_SENTINEL_PREFIX = "__AUTUMN_GATE__:";

// Gates required per model tier. Higher plans should unlock lower-tier
// features even when Autumn only returns the top-level entitlement/product.
// `sentinel` is what we report back to the client so the upgrade modal can
// show the right copy. Auto rides on paid access but reports itself as `auto`.
export type Gate = {
  featureIds: readonly string[];
  productIds?: readonly string[];
  sentinel: string;
};

// The premium line, sold apart from the ladder below and only while an admin
// has opened it for purchase (see convex/platinum.ts). Platinum customers are
// paid customers in every respect — these ids ride in PAID_PRODUCT_IDS, so
// every gate and meter treats them like any other plan — plus two perks no
// other plan gets: the Fast tier never touches their usage pool, and custom
// catalog models bill without the usual premium.
export const PLATINUM_PRODUCT_IDS = ["platinum", "platinum_max"] as const;

// Free customers are metered by a `messages` count; paid customers by the
// shared `usage` pool. A customer counts as paid when any paid product is
// active (or trialing).
export const PAID_PRODUCT_IDS = [
  "mini",
  "turbo",
  "mega",
  ...PLATINUM_PRODUCT_IDS,
] as const;

// The feature-flag half of the same question. Autumn answers entitlement in
// two vocabularies (features and products) and doesn't always return both, so
// every "is this customer paying us anything?" gate asks in both.
export const PAID_FEATURE_IDS = ["basic", "pro", "max"] as const;

// Every paid plan gets every model — the plans differ by how much usage they
// buy, not by which models they reach. So each tier's gate is the same paid
// check; only the `sentinel` differs, so the upgrade modal can name the thing
// the user was reaching for.
export const MODEL_REQUIRED_FLAGS: Record<ModelKey, readonly Gate[]> = {
  Auto: [
    {
      featureIds: PAID_FEATURE_IDS,
      productIds: PAID_PRODUCT_IDS,
      sentinel: "auto",
    },
  ],
  // Free-only in practice: paid traffic never reaches this key because
  // effectiveModelKeyFor remaps it to Basic first.
  Fast: [],
  Basic: [
    {
      featureIds: PAID_FEATURE_IDS,
      productIds: PAID_PRODUCT_IDS,
      sentinel: "basic",
    },
  ],
  // Heavy.
  Max: [
    {
      featureIds: PAID_FEATURE_IDS,
      productIds: PAID_PRODUCT_IDS,
      sentinel: "max",
    },
  ],
  // Image generation — its own sentinel so the upgrade modal can talk about
  // pictures rather than models.
  Image: [
    {
      featureIds: PAID_FEATURE_IDS,
      productIds: PAID_PRODUCT_IDS,
      sentinel: "image",
    },
  ],
};

// The Image tier's gate, exported for callers that need to reference it
// outside MODEL_REQUIRED_FLAGS (e.g. client-side sentinel mapping tests).
export const IMAGE_GATE: Gate = MODEL_REQUIRED_FLAGS.Image[0];

// Applied when an admin restricts a tier that carries no paid gate of its
// own (i.e. the Free tier itself, whose MODEL_REQUIRED_FLAGS entry is
// empty) — any paid plan passes, everyone else gets the upgrade modal.
export const FREE_LOCKED_GATE: Gate = {
  featureIds: PAID_FEATURE_IDS,
  productIds: PAID_PRODUCT_IDS,
  sentinel: "basic",
};

// Thinking is a perk of every paid plan.
export const REASONING_GATE: Gate = {
  featureIds: ["reasoning", ...PAID_FEATURE_IDS],
  productIds: PAID_PRODUCT_IDS,
  sentinel: "reasoning",
};

export const SEARCH_GATE: Gate = {
  featureIds: ["can_search", ...PAID_FEATURE_IDS],
  productIds: PAID_PRODUCT_IDS,
  sentinel: "can_search",
};

// Free uploads are allowed but capped at 1 MB per file (images excepted — they
// are auto-compressed before upload); any paid plan lifts the cap. Mirrors
// FREE_MAX_FILE_BYTES in app/lib/attachment-upload.ts — keep the two in sync.
export const FREE_MAX_FILE_BYTES = 1024 * 1024;

// Lifting the 1 MB free-upload cap is a paid perk. There's no dedicated Autumn
// feature for it, so any paid product/feature unlocks it. The client enforces
// the cap per-file before upload; this is the server-side backstop for requests
// that smuggle an oversized non-image file past the UI.
export const UPLOAD_GATE: Gate = {
  featureIds: PAID_FEATURE_IDS,
  productIds: PAID_PRODUCT_IDS,
  sentinel: "files",
};

// Thread compaction bills against the paid `usage` pool (via `ai_cost`), so
// free customers can't compact — they only have the `messages` meter.
export const COMPACTION_GATE: Gate = {
  featureIds: PAID_FEATURE_IDS,
  productIds: PAID_PRODUCT_IDS,
  sentinel: "compact",
};

// `usage` is the plan-included USD pool; `extra_usage` is the separate, paid
// top-up bucket. They are two distinct balances: plan usage is always spent
// first, and the extra bucket only covers the overflow once the plan pool runs
// dry (see deductUsageWithOverflow). A paid request is allowed while *either*
// bucket still has balance, so the gate checks both.
export const USAGE_FEATURE_ID = "usage";
export const EXTRA_USAGE_FEATURE_ID = "extra_usage";
export const EXTRA_USAGE_PRODUCT_ID = "extra_usage";

// Both buckets are credit systems whose spend flows through member features:
// AI token spend hits `ai_cost`, web-search spend hits `search`. We track the
// plan portion of a charge against the relevant member (which draws from
// `usage`) and the overflow directly against `extra_usage`.
export const AI_COST_FEATURE_ID = "ai_cost";
export const SEARCH_FEATURE_ID = "search";

// Image generations (the Image tier and the generateImage tool's background
// worker alike) deduct a multiple of the provider's reported cost from the
// user's usage pool. Deliberately not surfaced anywhere in the product.
export const IMAGE_COST_MARKUP = 2;

// Custom catalog models (admin-added, by-name) don't ride the white-label
// tiers' negotiated economics, so their turns bill a 20% premium over the
// provider's reported cost. Applies wherever a custom slug serves a request
// (chat turns, full HTML builds). Deliberately not surfaced in the product —
// the Platinum page only promises "better rates on specialist models".
export const CUSTOM_MODEL_COST_MARKUP = 1.2;

/** Platinum waives the custom-model premium; everyone else pays it. */
export function customModelMarkupFor(isPlatinum: boolean): number {
  return isPlatinum ? 1 : CUSTOM_MODEL_COST_MARKUP;
}

// The tier the product calls "Fast" (internal key `Basic`). Platinum's
// headline perk is that turns on it never draw down the usage pool.
export const PLATINUM_FREE_MODEL_KEY: ModelKey = "Basic";

/**
 * Whether this turn rides Platinum's unmetered Fast tier. Custom catalog
 * models book under the Auto key and are excluded explicitly anyway — a
 * custom slug is somebody else's compute, so it always bills.
 */
export function isUnmeteredPlatinumTurn({
  isPlatinum,
  modelKey,
  isCustomModel,
}: {
  isPlatinum: boolean;
  modelKey: ModelKey;
  isCustomModel: boolean;
}): boolean {
  return isPlatinum && !isCustomModel && modelKey === PLATINUM_FREE_MODEL_KEY;
}

// The balance features a paid request can draw from, in priority order.
export const USAGE_BALANCE_FEATURE_IDS = [
  USAGE_FEATURE_ID,
  EXTRA_USAGE_FEATURE_ID,
] as const;

export const USAGE_GATE: Gate = {
  featureIds: USAGE_BALANCE_FEATURE_IDS,
  sentinel: "usage",
};

// Free customers are metered by a small `messages` count instead of the USD
// `usage` pool. When it runs dry the client shows the "upgrade" copy.
export const MESSAGES_GATE: Gate = {
  featureIds: ["messages"],
  sentinel: "messages",
};

// Server-overload throttle: when free-tier traffic has cost Whirl too much in a
// single day, free users' per-day message cap is tightened below their normal
// allowance. Tiers are checked most-expensive first; the first threshold the
// daily cost clears wins. Paid users are NEVER throttled by this. The dollar
// figure comes from a PostHog endpoint (see convex/serverLoad.ts).
export const FREE_OVERLOAD_TIERS: readonly {
  costUsd: number;
  messageCap: number;
}[] = [
  { costUsd: 10, messageCap: 2 },
  { costUsd: 7, messageCap: 5 },
  { costUsd: 5, messageCap: 10 },
];

// The tightened daily message cap for a given free-user daily cost, or `null`
// when spend is below the first threshold (no overload — the normal allowance
// applies). Also drives the severity level surfaced to the client (1-based
// index into FREE_OVERLOAD_TIERS); 0 means "no overload".
export function resolveOverloadCap(
  costUsd: number | null | undefined,
): number | null {
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd)) return null;
  for (const tier of FREE_OVERLOAD_TIERS) {
    if (costUsd >= tier.costUsd) return tier.messageCap;
  }
  return null;
}

// 0 when not overloaded, otherwise 1..FREE_OVERLOAD_TIERS.length (more severe =
// higher). Kept separate from the cap so the client can show a vague severity
// without ever learning the underlying dollar amount.
export function resolveOverloadLevel(
  costUsd: number | null | undefined,
): number {
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd)) return 0;
  for (let i = 0; i < FREE_OVERLOAD_TIERS.length; i += 1) {
    if (costUsd >= FREE_OVERLOAD_TIERS[i].costUsd) {
      return FREE_OVERLOAD_TIERS.length - i;
    }
  }
  return 0;
}

// Sentinel written as a free user's assistant message content when an overload
// cap blocks the send. The client parses it (see lib/server-load.ts) to render
// the vague "servers under extra load" notice instead of a hard error or the
// upgrade banner. Distinct from GATE_SENTINEL_PREFIX so the two never collide.
export const OVERLOAD_SENTINEL = "__SERVER_OVERLOAD__";

// Per-model `reasoning` provider options for when the user's thinking toggle
// is OFF, verified against OpenRouter (July 2026):
// - Fast (gpt-5.4-nano) supports turning reasoning fully off, so we do exactly
//   that — `enabled: false` means OFF means OFF, no hidden thinking tokens.
// - Basic (Kimi K2.6) is a hybrid thinker: `enabled: false` selects its
//   non-thinking mode. Never send an effort here — any effort value would
//   ENABLE thinking.
// - Auto can route to reasoning-by-default models, so exclude any reasoning
//   from the output. Don't set an effort here: that would ENABLE thinking on
//   reasoning-capable routes.
// - Max/Heavy (Grok 4.5) always reasons and can't be turned off, so the best
//   "off" is hiding the reasoning from the output entirely.
export const REASONING_OFF_OPTIONS: Record<
  ModelKey,
  { reasoning: { enabled?: false; effort?: "low"; exclude?: true } } | undefined
> = {
  Auto: { reasoning: { exclude: true } },
  Fast: { reasoning: { enabled: false } },
  Basic: { reasoning: { enabled: false } },
  Max: { reasoning: { exclude: true } },
  // Image never goes through the chat-completions reasoning path.
  Image: undefined,
};

// Unknowns fold into Auto — that includes custom catalog slugs on purpose:
// they bill and gate under the Auto key while the slug itself serves the
// request via the override path (streamModelConfigInternal's `custom`).
export function resolveModelKey(model: string | undefined): ModelKey {
  if (model && Object.prototype.hasOwnProperty.call(MODEL_IDS, model)) {
    return model as ModelKey;
  }
  return "Auto";
}

// The reasoning-off table above is verified against the DEFAULT tier models,
// so it can't speak for an admin override (console Models tab). For an
// overridden tier: a reasoning-capable model gets `exclude` (hide it — the
// universally safe "off"), and a model without the reasoning parameter gets
// nothing at all, since any reasoning config risks a hard reject.
export function reasoningOffOptionsFor(
  modelKey: ModelKey,
  override: { capabilities: { reasoning: boolean } } | null,
): { reasoning: { enabled?: false; effort?: "low"; exclude?: true } } | object {
  if (!override) return REASONING_OFF_OPTIONS[modelKey] ?? {};
  return override.capabilities.reasoning ? { reasoning: { exclude: true } } : {};
}

export function createOpenRouterChatModel({
  apiKey,
  modelKey,
  overrideSlug,
}: {
  apiKey: string;
  modelKey: ModelKey;
  // Admin tier override (convex/models.ts) — routes the tier to this slug
  // instead of its MODEL_IDS default.
  overrideSlug?: string;
}) {
  const openRouter = createOpenRouter({ apiKey });
  const modelId = overrideSlug ?? MODEL_IDS[modelKey];

  // Leave provider routing to OpenRouter so account privacy settings and
  // current provider availability can both be honored.
  const model = openRouter.chat(modelId, {
    // A single model step can otherwise fan out into dozens of integration
    // calls before the SDK's step cap can intervene.
    parallelToolCalls: false,
  });

  // The provider's stock image allowlist is anchored on file extensions —
  // Convex storage URLs have none, so the SDK "helpfully" downloads each
  // image and base64-inlines it INSIDE the stream's 64MB isolate, which
  // OOMs on multi-MB uploads ("JavaScript execution ran out of memory").
  // OpenRouter fetches plain https URLs provider-side just fine; accept
  // them all so image parts ride through as URLs, never as bytes here.
  // (Typed read-only, but it's a plain instance field set in the
  // provider's constructor — this override is the whole point.)
  (model as { supportedUrls: Record<string, RegExp[]> }).supportedUrls = {
    ...model.supportedUrls,
    "image/*": [/^data:image\/[a-zA-Z]+;base64,/, /^https?:\/\//],
  };
  return model;
}

export async function checkAutumnGate({
  autumn,
  customerId,
  gate,
}: {
  autumn: Autumn;
  customerId: string;
  gate: Gate;
}) {
  const checks = [
    ...gate.featureIds.map((featureId) =>
      autumn.check({
        customer_id: customerId,
        feature_id: featureId,
        ...((USAGE_BALANCE_FEATURE_IDS as readonly string[]).includes(featureId)
          ? { required_balance: MIN_USAGE_BALANCE_REQUIRED }
          : {}),
      }),
    ),
    ...(gate.productIds ?? []).map((productId) =>
      autumn.check({
        customer_id: customerId,
        product_id: productId,
      }),
    ),
  ];

  const results = await Promise.all(checks);
  return results.some(({ data, error }) => !error && data?.allowed);
}

export async function isPaidCustomer({
  autumn,
  customerId,
}: {
  autumn: Autumn;
  customerId: string;
}) {
  const results = await Promise.all(
    PAID_PRODUCT_IDS.map((productId) =>
      autumn.check({
        customer_id: customerId,
        product_id: productId,
      }),
    ),
  );
  return results.some(({ data, error }) => !error && data?.allowed);
}

// --- Single-fetch gate derivation --------------------------------------------
// The per-request preflight needs `isPaid` plus several feature/product gates.
// Each `autumn.check()` and `isPaidCustomer()` call is its own Autumn round trip,
// so the old path stacked ~11 of them (in two batches) before the first token.
// A single `autumn.customers.get()` returns the whole entitlement picture —
// products (with status) and the feature map (with balances) — so we fetch once
// and answer every gate locally with the SAME semantics `check()` uses. The
// callers fall back to the per-check functions above whenever this fetch fails,
// so a customer-read blip degrades to the proven path instead of misgating.

export type BillingCustomer = Customer;

// Fetch the full customer entitlement snapshot once. Returns null on any read
// error so the caller can fall back to individual checks rather than treat a
// transient failure as "no access".
export async function fetchBillingCustomer({
  autumn,
  customerId,
}: {
  autumn: Autumn;
  customerId: string;
}): Promise<BillingCustomer | null> {
  const { data, error } = await autumn.customers.get(customerId);
  if (error || !data) return null;
  return data;
}

// A product grants access while its subscription is live. active/trialing are
// plainly entitled; past_due is a payment-retry grace window where the customer
// still has the plan — cutting them off there would wrongly downgrade a paying
// user mid-cycle. scheduled (not started) and expired (ended) do not grant.
const ENTITLING_PRODUCT_STATUSES = new Set(["active", "trialing"]);

function productEntitled(customer: BillingCustomer, productId: string): boolean {
  return customer.products.some(
    (product) =>
      product.id === productId &&
      ENTITLING_PRODUCT_STATUSES.has(product.status),
  );
}

// Mirror `autumn.check({ feature_id })`'s `allowed`, read off the feature map:
// - absent => not granted by the plan.
// - unlimited or overage-allowed => always allowed (check's usage_limit pass).
// - static features are boolean entitlement flags (check's feature_flag
//   scenario): present in the map == granted, no balance involved.
// - metered features are allowed while balance covers the required amount
//   (default 1 unit, matching check's default required_balance).
function featureEntitled(
  customer: BillingCustomer,
  featureId: string,
  requiredBalance?: number,
): boolean {
  const feature = customer.features?.[featureId];
  if (!feature) return false;
  if (feature.unlimited) return true;
  if (feature.type === "static") return true;
  if (feature.overage_allowed) return true;
  const balance = typeof feature.balance === "number" ? feature.balance : 0;
  return balance >= (requiredBalance ?? 1);
}

// Local equivalent of isPaidCustomer() from a prefetched snapshot.
export function snapshotIsPaid(customer: BillingCustomer): boolean {
  return PAID_PRODUCT_IDS.some((productId) =>
    productEntitled(customer, productId),
  );
}

// What the request path needs to know about a customer's plan: whether they
// pay us anything (which meter they're on) and whether they're on Platinum
// (which perks apply). Derived together because both answers come from the
// same set of product entitlements — asking twice would double the round
// trips on the fallback path for no new information.
export type PlanState = { isPaid: boolean; isPlatinum: boolean };

export function snapshotPlanState(customer: BillingCustomer): PlanState {
  return {
    isPaid: snapshotIsPaid(customer),
    isPlatinum: PLATINUM_PRODUCT_IDS.some((productId) =>
      productEntitled(customer, productId),
    ),
  };
}

/**
 * The per-check equivalent of snapshotPlanState, used when the customer
 * snapshot read failed. One round trip per paid product, all in flight at
 * once — the same shape isPaidCustomer() has always had, just reading the
 * Platinum answer out of results we were already fetching.
 */
export async function readPlanState({
  autumn,
  customerId,
}: {
  autumn: Autumn;
  customerId: string;
}): Promise<PlanState> {
  const entitled = await Promise.all(
    PAID_PRODUCT_IDS.map(async (productId) => {
      const { data, error } = await autumn.check({
        customer_id: customerId,
        product_id: productId,
      });
      return !error && data?.allowed === true ? productId : null;
    }),
  );
  const active = new Set<string>(
    entitled.filter((id) => id !== null) as string[],
  );
  return {
    isPaid: active.size > 0,
    isPlatinum: PLATINUM_PRODUCT_IDS.some((productId) => active.has(productId)),
  };
}

/* Billing is optional. A deployment without AUTUMN_SECRET_KEY (a self-hosted
   instance, local dev) has no plans to sell, so the request path treats
   everyone as paid: every perk is open, no gate is checked, and nothing is
   deducted. The usage ledger still writes each turn's provider cost onto its
   message, so the usage tab keeps telling the truth. */
export function createBillingClient(): Autumn | null {
  const secretKey = process.env.AUTUMN_SECRET_KEY;
  return secretKey ? new Autumn({ secretKey }) : null;
}

export const UNBILLED_PLAN_STATE: PlanState = {
  isPaid: true,
  isPlatinum: false,
};

// Local equivalent of checkAutumnGate() from a prefetched snapshot: allowed when
// ANY of the gate's features is entitled OR ANY of its products is active — the
// same OR the per-check version applies (higher plans unlock lower tiers).
export function snapshotGateAllowed(
  customer: BillingCustomer,
  gate: Gate,
): boolean {
  const featureOk = gate.featureIds.some((featureId) =>
    featureEntitled(
      customer,
      featureId,
      (USAGE_BALANCE_FEATURE_IDS as readonly string[]).includes(featureId)
        ? MIN_USAGE_BALANCE_REQUIRED
        : undefined,
    ),
  );
  if (featureOk) return true;
  return (gate.productIds ?? []).some((productId) =>
    productEntitled(customer, productId),
  );
}

// Local equivalent of readFreeMessageUsage() from a prefetched snapshot. Kept
// byte-for-byte consistent with that function's balance math.
export function snapshotFreeMessageUsage(customer: BillingCustomer): {
  included: number;
  used: number;
  balance: number;
} {
  const feature = customer.features?.messages;
  const included =
    typeof feature?.included_usage === "number" && feature.included_usage > 0
      ? feature.included_usage
      : 0;
  const balance =
    typeof feature?.balance === "number"
      ? Math.max(0, feature.balance)
      : included;
  const used = Math.max(0, included - balance);
  return { included, used, balance };
}

// How many of a free customer's daily `messages` they've already spent this
// period, read from the same Autumn feature the UI trusts. `included` is the
// granted allowance, `used` how many are spent. Used to enforce the overload
// cap, which tightens the effective allowance below `included`. On a read error
// everything comes back 0 so the caller never wrongly blocks a send.
export async function readFreeMessageUsage({
  autumn,
  customerId,
}: {
  autumn: Autumn;
  customerId: string;
}): Promise<{ included: number; used: number; balance: number }> {
  const { data: customer, error } = await autumn.customers.get(customerId);
  const feature = !error ? customer?.features?.messages : undefined;
  const included =
    typeof feature?.included_usage === "number" && feature.included_usage > 0
      ? feature.included_usage
      : 0;
  const balance =
    typeof feature?.balance === "number"
      ? Math.max(0, feature.balance)
      : included;
  const used = Math.max(0, included - balance);
  return { included, used, balance };
}

// True when the customer can still spend — either the plan `usage` pool or the
// purchased `extra_usage` bucket has balance left. Used by the title and
// compaction paths, which only run when there's budget to cover them.
export async function hasUsageBalance({
  autumn,
  customerId,
}: {
  autumn: Autumn;
  customerId: string;
}) {
  for (const featureId of USAGE_BALANCE_FEATURE_IDS) {
    const { data, error } = await autumn.check({
      customer_id: customerId,
      feature_id: featureId,
      required_balance: MIN_USAGE_BALANCE_REQUIRED,
    });
    if (!error && data?.allowed) {
      return true;
    }
  }
  return false;
}

// Deduct a USD charge with plan-first priority: spend the plan `usage` pool
// down to zero, then bill the remainder to the purchased `extra_usage` bucket.
// `amount` is the already-scaled value to deduct (caller applies any usage
// multiplier). The plan portion is tracked against `primaryFeatureId` (its
// credit-system member — `ai_cost` or `search`); the overflow goes straight to
// `extra_usage`. Each portion gets its own idempotency key so retries are safe.
// On a transient balance-read error we bill the whole charge to the plan pool
// rather than risk draining purchased credit.
export async function deductUsageWithOverflow({
  autumn,
  customerId,
  amount,
  primaryFeatureId,
  idempotencyKey,
}: {
  autumn: Autumn;
  customerId: string;
  amount: number;
  primaryFeatureId: typeof AI_COST_FEATURE_ID | typeof SEARCH_FEATURE_ID;
  idempotencyKey: string;
}): Promise<{ usagePortion: number; extraPortion: number }> {
  if (!(amount > 0)) return { usagePortion: 0, extraPortion: 0 };

  // Read the plan pool's remaining balance from the customer's feature map —
  // the same field the UI trusts. We deliberately avoid `check().balance`: for
  // a credit-system feature it can come back null/undefined, which would make
  // us treat the pool as "unknown" and never bill the extra-usage overflow.
  // `planBalance` stays null only when we genuinely can't read it (a transient
  // error), in which case we bill the plan rather than risk draining purchased
  // credit. An unlimited plan never overflows.
  let planBalance: number | null = null;
  const { data: customer, error } = await autumn.customers.get(customerId);
  if (!error && customer) {
    const usage = customer.features?.[USAGE_FEATURE_ID];
    if (usage?.unlimited) {
      planBalance = amount;
    } else if (typeof usage?.balance === "number") {
      planBalance = Math.max(0, usage.balance);
    } else {
      // Customer read succeeded but the plan pool has no numeric balance left
      // (e.g. fully drained) — send the whole charge to the extra bucket.
      planBalance = 0;
    }
  }

  const usagePortion = planBalance == null ? amount : Math.min(amount, planBalance);
  const extraPortion = amount - usagePortion;

  if (usagePortion > 0) {
    await trackOrThrow(autumn, {
      customer_id: customerId,
      feature_id: primaryFeatureId,
      value: usagePortion,
      idempotency_key: `${idempotencyKey}:usage`,
    });
  }
  if (extraPortion > 0) {
    await trackOrThrow(autumn, {
      customer_id: customerId,
      feature_id: EXTRA_USAGE_FEATURE_ID,
      value: extraPortion,
      idempotency_key: `${idempotencyKey}:extra`,
    });
  }

  return { usagePortion, extraPortion };
}

// `autumn.track()` reports failure by RETURNING an error, not by throwing — so
// awaiting it without reading the result treats a rejected charge as a
// collected one. Turn it into an exception, which is what every caller already
// assumed it was: the usage ledger catches it and retries the charge later
// (see convex/usageLedger.ts).
async function trackOrThrow(
  autumn: Autumn,
  params: {
    customer_id: string;
    feature_id: string;
    value: number;
    idempotency_key: string;
  },
): Promise<void> {
  const { error } = await autumn.track(params);
  if (error) {
    throw new Error(
      `Autumn rejected the ${params.feature_id} charge: ${
        typeof error === "string" ? error : JSON.stringify(error)
      }`,
    );
  }
}
