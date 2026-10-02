import { Autumn } from "autumn-js";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

// Paid product ids in Autumn. Mirrors PAID_PRODUCT_IDS in inference.ts — kept
// in sync so the admin "by plan" filter matches how the app meters users.
const PAID_PRODUCT_IDS = [
  "mini",
  "turbo",
  "mega",
  "platinum",
  "platinum_max",
] as const;

// Usage features we reset. Paid users draw from `usage`; free users from
// `messages`. Resetting a feature the customer doesn't have is harmless (Autumn
// errors and we move on), so we just attempt both.
const RESETTABLE_FEATURE_IDS = ["usage", "messages"] as const;

// Safety cap when enumerating all customers for plan/all resets, so a runaway
// account base can't blow the action's time budget. 50 pages * 100 = 5000.
const MAX_CUSTOMER_PAGES = 50;
const CUSTOMER_PAGE_SIZE = 100;

// Playful default copy shown to a user on their next visit after an admin
// resets their quota, when the admin doesn't supply custom text. A random one
// is picked per user so a batch reset doesn't show everyone the same line.
const DEFAULT_RESET_MESSAGES = [
  "Lucky you — your usage quota just got a fresh reset. Go wild.",
  "Surprise! Your usage quota is back to full. Make it count.",
  "Ka-ching! We just topped your usage quota right back up.",
  "Fresh slate, full tank — your usage quota has been reset.",
  "You've been refilled! Your usage quota is good as new. ✨",
  "Boom. Full quota, zero guilt. Have at it.",
  "A wild reset appeared! Your usage quota is full again.",
  "Treat yourself — your usage quota just bounced back to full.",
];

function pickDefaultResetMessage(): string {
  const index = Math.floor(Math.random() * DEFAULT_RESET_MESSAGES.length);
  return DEFAULT_RESET_MESSAGES[index];
}

type AnyCtx = QueryCtx | MutationCtx | ActionCtx;

// --- Admin auth -------------------------------------------------------------

// The admin role is delivered via a Clerk custom-metadata claim surfaced into
// the Convex JWT. Configure the Clerk "convex" JWT template to add a claim
// `"role": "{{user.public_metadata.role}}"`, then set publicMetadata.role to
// "admin" on the admin user. We read it defensively from a few shapes in case
// the claim is delivered nested.
function extractRole(identity: Record<string, unknown>): string | undefined {
  const direct = identity.role;
  if (typeof direct === "string") return direct;
  const meta =
    (identity.publicMetadata as Record<string, unknown> | undefined) ??
    (identity.public_metadata as Record<string, unknown> | undefined) ??
    (identity.metadata as Record<string, unknown> | undefined);
  if (meta && typeof meta.role === "string") return meta.role;
  return undefined;
}

export async function isAdminIdentity(ctx: AnyCtx): Promise<boolean> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return false;
  return extractRole(identity as unknown as Record<string, unknown>) === "admin";
}

/**
 * Throws unless the caller is an authenticated admin. Every admin query,
 * mutation, and action calls this — the client-side gate is convenience only.
 * Also used by the console's approvals flow (see convex/integrations.ts).
 */
export async function requireAdmin(ctx: AnyCtx): Promise<void> {
  if (!(await isAdminIdentity(ctx))) {
    throw new ConvexError("Admin access required");
  }
}

/** Lets the frontend show/hide the admin UI. Never the sole gate. */
export const isAdmin = query({
  args: {},
  handler: async (ctx) => isAdminIdentity(ctx),
});

// --- Usage-multiplier event config -----------------------------------------

type AdminConfigDoc = {
  multiplier?: number;
  headline?: string;
  subtext?: string;
  applyToFreeMessages?: boolean;
  startsAt?: number;
  expiresAt?: number;
  enabled?: boolean;
  updatedAt: number;
};

type ActiveMultiplier = {
  multiplier: number;
  headline: string;
  subtext: string | null;
  applyToFreeMessages: boolean;
  expiresAt: number | null;
};

async function readAdminConfig(ctx: QueryCtx): Promise<AdminConfigDoc | null> {
  return await ctx.db.query("adminConfig").first();
}

// Returns the multiplier event only while it's both enabled and inside its
// window; null otherwise. Shared by the public query, the internal read used by
// the deduction path, and (indirectly) the banner/pricing UI.
function computeActiveMultiplier(
  doc: AdminConfigDoc | null,
  now: number,
): ActiveMultiplier | null {
  if (!doc) return null;
  if (doc.enabled !== true) return null;
  if (typeof doc.multiplier !== "number" || doc.multiplier <= 0) return null;
  if (typeof doc.startsAt === "number" && now < doc.startsAt) return null;
  if (typeof doc.expiresAt === "number" && now > doc.expiresAt) return null;
  return {
    multiplier: doc.multiplier,
    headline: doc.headline ?? "",
    subtext: doc.subtext ?? null,
    applyToFreeMessages: doc.applyToFreeMessages === true,
    expiresAt: doc.expiresAt ?? null,
  };
}

/** An enabled event with its raw window — clients decide if it's live. */
type MultiplierEvent = ActiveMultiplier & { startsAt: number | null };

/**
 * Public: read by the global banner and the pricing page. Deliberately NOT
 * time-gated: a reactive query only re-runs when the *data* changes, so gating
 * on Date.now() here freezes the answer at subscription time — a scheduled
 * start would never flip the banner on, and an expiry never off. Instead this
 * returns any enabled event with its raw window and the client evaluates
 * start/end against a live clock (see useActiveMultiplier). The deduction
 * path keeps server-side gating via getActiveMultiplierInternal, which runs
 * fresh on every call.
 */
export const getActiveMultiplier = query({
  args: {},
  handler: async (ctx): Promise<MultiplierEvent | null> => {
    const doc = await readAdminConfig(ctx);
    if (!doc || doc.enabled !== true) return null;
    if (typeof doc.multiplier !== "number" || doc.multiplier <= 0) return null;
    return {
      multiplier: doc.multiplier,
      headline: doc.headline ?? "",
      subtext: doc.subtext ?? null,
      applyToFreeMessages: doc.applyToFreeMessages === true,
      startsAt: doc.startsAt ?? null,
      expiresAt: doc.expiresAt ?? null,
    };
  },
});

/** Internal: read by the inference / compaction deduction path. */
export const getActiveMultiplierInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<ActiveMultiplier | null> => {
    return computeActiveMultiplier(await readAdminConfig(ctx), Date.now());
  },
});

/** Admin: raw singleton for populating the admin form. */
export const getMultiplierConfig = query({
  args: {},
  handler: async (ctx): Promise<AdminConfigDoc | null> => {
    await requireAdmin(ctx);
    return await readAdminConfig(ctx);
  },
});

/** Admin: upsert the multiplier event config. */
export const setMultiplierConfig = mutation({
  args: {
    multiplier: v.number(),
    headline: v.string(),
    subtext: v.optional(v.string()),
    applyToFreeMessages: v.boolean(),
    startsAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const patch = {
      multiplier: args.multiplier,
      headline: args.headline,
      subtext: args.subtext,
      applyToFreeMessages: args.applyToFreeMessages,
      startsAt: args.startsAt,
      expiresAt: args.expiresAt,
      enabled: args.enabled,
      updatedAt: Date.now(),
    };
    const existing = await ctx.db.query("adminConfig").first();
    if (existing) {
      await ctx.db.replace(existing._id, patch);
    } else {
      await ctx.db.insert("adminConfig", patch);
    }
    return null;
  },
});

// --- User listing + usage resets (Autumn) ----------------------------------

type ListedUser = {
  id: string;
  email: string | null;
  name: string | null;
  plan: string;
  usageBalance: number | null;
  usageIncluded: number | null;
  messagesBalance: number | null;
  messagesIncluded: number | null;
};

type AutumnProduct = {
  id: string;
  status?: string | null;
  is_add_on?: boolean;
  is_default?: boolean;
};
type AutumnFeature = {
  balance?: number | null;
  included_usage?: number;
};
type AutumnCustomer = {
  id: string | null;
  email: string | null;
  name: string | null;
  products?: AutumnProduct[];
  features?: Record<string, AutumnFeature>;
};

const ACTIVE_PRODUCT_STATUSES = new Set(["active", "trialing", "past_due"]);

// The user's effective plan: the active paid product if any, else "free".
function derivePlan(customer: AutumnCustomer): string {
  const products = customer.products ?? [];
  for (const product of products) {
    if (product.is_add_on) continue;
    const status = product.status ?? "active";
    if (!ACTIVE_PRODUCT_STATUSES.has(status)) continue;
    if ((PAID_PRODUCT_IDS as readonly string[]).includes(product.id)) {
      return product.id;
    }
  }
  return "free";
}

function toListedUser(customer: AutumnCustomer): ListedUser {
  const usage = customer.features?.usage;
  const messages = customer.features?.messages;
  return {
    id: customer.id ?? "",
    email: customer.email,
    name: customer.name,
    plan: derivePlan(customer),
    usageBalance: usage?.balance ?? null,
    usageIncluded: usage?.included_usage ?? null,
    messagesBalance: messages?.balance ?? null,
    messagesIncluded: messages?.included_usage ?? null,
  };
}

function makeAutumn(): Autumn {
  const secretKey = process.env.AUTUMN_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Missing AUTUMN_SECRET_KEY");
  }
  return new Autumn({ secretKey });
}

// --- Autumn rate-limit handling ----------------------------------------------
// Autumn throttles bursts of API calls — and a full-page scan or a bulk reset
// is nothing but a burst. Worse, its 429 comes back as a *plain-text* "Too
// many requests" body that autumn-js crashes on trying to JSON.parse (the
// "Unexpected token 'T'" SyntaxError). So: spot rate-limit failures by any of
// their disguises, back off exponentially, and pace page scans so they
// usually don't trip the limiter at all.

const RATE_LIMIT_MAX_RETRIES = 6;
const RATE_LIMIT_BASE_DELAY_MS = 750;
// Breather between list pages — a scan is bursty by nature; this keeps it
// under the limiter's radar without adding meaningful wall-clock time.
const LIST_PAGE_PACING_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimited(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /too many r|rate.?limit|429/i.test(message);
}

/** Run an Autumn call, retrying rate-limit failures with jittered backoff. */
async function withRateLimitRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (!isRateLimited(error) || attempt >= RATE_LIMIT_MAX_RETRIES) {
        throw error;
      }
      await sleep(
        RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt + Math.random() * 250,
      );
    }
  }
}

/** One customers page, with rate-limit retries and result errors thrown. */
async function listCustomersPage(
  autumn: Autumn,
  offset: number,
  limit: number,
): Promise<{ customers: AutumnCustomer[]; total: number | null }> {
  return await withRateLimitRetry(async () => {
    const { data, error } = await autumn.customers.list({ limit, offset });
    if (error || !data) {
      throw new Error(error?.message ?? "Failed to list customers");
    }
    return {
      customers: (data.list ?? []) as unknown as AutumnCustomer[],
      total:
        typeof (data as { total?: number }).total === "number"
          ? (data as { total: number }).total
          : null,
    };
  });
}

// Walk every Autumn customer page (bounded by MAX_CUSTOMER_PAGES), handing
// each customer to `visit`. Shared by search/plan listing and bulk resets.
async function pageCustomers(
  autumn: Autumn,
  visit: (customer: AutumnCustomer) => void,
): Promise<{ truncated: boolean }> {
  for (let page = 0; page < MAX_CUSTOMER_PAGES; page++) {
    const { customers } = await listCustomersPage(
      autumn,
      page * CUSTOMER_PAGE_SIZE,
      CUSTOMER_PAGE_SIZE,
    );
    for (const customer of customers) visit(customer);
    if (customers.length < CUSTOMER_PAGE_SIZE) return { truncated: false };
    await sleep(LIST_PAGE_PACING_MS);
  }
  return { truncated: true };
}

function matchesSearch(user: ListedUser, q: string): boolean {
  return (
    (user.email ?? "").toLowerCase().includes(q) ||
    (user.name ?? "").toLowerCase().includes(q) ||
    user.id.toLowerCase().includes(q)
  );
}

/**
 * Autumn customers for the admin table. Without filters this is one cheap
 * page straight from Autumn. With a `search` query or a `plan` filter, Autumn
 * offers no server-side filtering, so this scans every page (bounded by
 * MAX_CUSTOMER_PAGES) and slices the matches — otherwise a search could only
 * ever find users on the page already loaded.
 */
export const listUsers = action({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    plan: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    users: ListedUser[];
    total: number | null;
    truncated: boolean;
  }> => {
    await requireAdmin(ctx);
    const autumn = makeAutumn();
    const limit = Math.min(Math.max(args.limit ?? CUSTOMER_PAGE_SIZE, 1), 100);
    const offset = Math.max(args.offset ?? 0, 0);
    const q = args.search?.trim().toLowerCase() ?? "";

    if (q || args.plan) {
      const matches: ListedUser[] = [];
      const { truncated } = await pageCustomers(autumn, (customer) => {
        const user = toListedUser(customer);
        if (args.plan && user.plan !== args.plan) return;
        if (q && !matchesSearch(user, q)) return;
        matches.push(user);
      });
      return {
        users: matches.slice(offset, offset + limit),
        total: matches.length,
        truncated,
      };
    }

    const { customers, total } = await listCustomersPage(
      autumn,
      offset,
      limit,
    );
    return { users: customers.map(toListedUser), total, truncated: false };
  },
});

// Reset a single customer's usage by zeroing the usage counter on each feature,
// which restores their full included allotment. Returns true if at least one
// feature reset succeeded.
async function resetCustomer(autumn: Autumn, customerId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  let anyOk = false;
  let lastError: string | undefined;
  for (const featureId of RESETTABLE_FEATURE_IDS) {
    try {
      const { error } = await withRateLimitRetry(async () => {
        const result = await autumn.v2.balances.update({
          customer_id: customerId,
          feature_id: featureId,
          usage: 0,
        });
        // Rate limits that come back as parsed error results (rather than
        // the SDK throwing) must also throw to reach the retry loop.
        if (result.error && isRateLimited(result.error.message)) {
          throw new Error(result.error.message);
        }
        return result;
      });
      if (error) {
        lastError = error.message;
      } else {
        anyOk = true;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return anyOk ? { ok: true } : { ok: false, error: lastError };
}

// Collect customer ids for a plan/all reset by paging through Autumn.
async function collectCustomerIds(
  autumn: Autumn,
  plan: string | null,
): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  const { truncated } = await pageCustomers(autumn, (customer) => {
    if (!customer.id) return;
    if (plan && derivePlan(customer) !== plan) return;
    ids.push(customer.id);
  });
  return { ids, truncated };
}

/**
 * Reset usage quotas for a set of users: specific ids, everyone on a plan, or
 * all users. Each reset is best-effort and isolated so one failure doesn't
 * abort the batch; returns a per-batch summary.
 */
export const resetUsage = action({
  args: {
    target: v.union(
      v.object({ kind: v.literal("users"), ids: v.array(v.string()) }),
      v.object({ kind: v.literal("plan"), plan: v.string() }),
      v.object({ kind: v.literal("all") }),
    ),
    // Custom copy for the "your quota was reset" modal shown to each affected
    // user on their next visit. Falls back to a default when blank.
    message: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { target, message },
  ): Promise<{
    total: number;
    succeeded: number;
    failed: { id: string; error?: string }[];
    truncated: boolean;
  }> => {
    await requireAdmin(ctx);
    const autumn = makeAutumn();

    let ids: string[];
    let truncated = false;
    if (target.kind === "users") {
      ids = target.ids;
    } else {
      const collected = await collectCustomerIds(
        autumn,
        target.kind === "plan" ? target.plan : null,
      );
      ids = collected.ids;
      truncated = collected.truncated;
    }

    const succeededIds: string[] = [];
    const failed: { id: string; error?: string }[] = [];
    for (const id of ids) {
      const result = await resetCustomer(autumn, id);
      if (result.ok) {
        succeededIds.push(id);
      } else {
        failed.push({ id, error: result.error });
      }
    }

    // Queue a one-time notice for each user whose quota we actually reset. A
    // custom message (when provided) goes to everyone; otherwise each user gets
    // a random playful default so a batch doesn't feel canned.
    if (succeededIds.length > 0) {
      const custom = (message ?? "").trim();
      const notices = succeededIds.map((userId) => ({
        userId,
        message: custom || pickDefaultResetMessage(),
      }));
      await ctx.runMutation(internal.admin.recordResetNotices, { notices });
    }

    return {
      total: ids.length,
      succeeded: succeededIds.length,
      failed,
      truncated,
    };
  },
});

// --- Per-user reset notices -------------------------------------------------

/** Internal: upsert a pending reset notice for each affected user. */
export const recordResetNotices = internalMutation({
  args: {
    notices: v.array(
      v.object({ userId: v.string(), message: v.string() }),
    ),
  },
  handler: async (ctx, { notices }) => {
    const now = Date.now();
    for (const { userId, message } of notices) {
      const existing = await ctx.db
        .query("resetNotices")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, { message, createdAt: now });
      } else {
        await ctx.db.insert("resetNotices", { userId, message, createdAt: now });
      }
    }
    return null;
  },
});

/** The signed-in user's pending reset notice, if any. */
export const getPendingResetNotice = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ message: string; createdAt: number } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const notice = await ctx.db
      .query("resetNotices")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .first();
    return notice
      ? { message: notice.message, createdAt: notice.createdAt }
      : null;
  },
});

/** Clears the signed-in user's reset notice(s) once they've seen the modal. */
export const acknowledgeResetNotice = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const notices = await ctx.db
      .query("resetNotices")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .take(50);
    for (const notice of notices) {
      await ctx.db.delete(notice._id);
    }
    return null;
  },
});
