import { ConvexError, v, type Infer } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type DatabaseReader,
} from "./_generated/server";
import { isAdminIdentity, requireAdmin } from "./admin";
import { modelCapabilitiesValidator } from "./validators";

// Admin-curated AI models for the console's Models tab. Custom rows join
// v2's composer search list; tier rows swap the OpenRouter model behind a
// preset tier (Free/Fast/Heavy/Image — Auto stays Auto). Capabilities are
// never hand-entered: every save re-detects them from OpenRouter's model
// listing, which doubles as slug validation — a slug OpenRouter doesn't
// recognize can't be saved at all.

const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";

// Bound on catalog reads. Also a soft cap on how many custom models admins
// can add — the picker is a scroll list, not a database browser.
const MAX_MODELS = 100;
const MAX_BULK_MODELS = 50;
const MAX_PROVIDERS = 100;

const MAX_NAME_LENGTH = 60;
const MAX_SLUG_LENGTH = 120;
// Mirrors the console's SvgIconField cap.
const MAX_ICON_SVG_LENGTH = 32_000;

// The preset tiers an admin may override. Auto is excluded on purpose: it's
// OpenRouter's router, not a model choice. Keys are the internal billing
// keys (inference/billing.ts) — Fast is the Free tier, Basic is Fast, Max is
// Heavy.
const OVERRIDABLE_TIERS = ["Fast", "Basic", "Max", "Image"] as const;
type OverridableTier = (typeof OVERRIDABLE_TIERS)[number];

const bulkModelInputValidator = v.object({
  slug: v.string(),
  displayName: v.optional(v.string()),
  company: v.optional(v.string()),
  modelName: v.optional(v.string()),
});

// Every tier that can appear on the restriction list — Auto included; its
// model can't change, but whether free users get it can.
const RESTRICTABLE_TIERS = ["Auto", "Fast", "Basic", "Max", "Image"] as const;

// Out of the box only the Free tier (key Fast) is open to free users —
// mirrors MODEL_REQUIRED_FLAGS in inference/billing.ts.
const DEFAULT_RESTRICTED_TIERS = ["Auto", "Basic", "Max", "Image"];

const tierValidator = v.union(
  v.literal("Fast"),
  v.literal("Basic"),
  v.literal("Max"),
  v.literal("Image"),
);

export type ModelCapabilities = Infer<typeof modelCapabilitiesValidator>;

function isOverridableTier(value: string): value is OverridableTier {
  return (OVERRIDABLE_TIERS as readonly string[]).includes(value);
}

// --- OpenRouter capability detection -----------------------------------------

type DetectedModel = {
  slug: string;
  company: string;
  modelName: string;
  description: string;
  capabilities: ModelCapabilities;
};

type OpenRouterEndpointsResponse = {
  data?: {
    id?: string;
    name?: string;
    description?: string;
    architecture?: {
      input_modalities?: string[];
      output_modalities?: string[];
    };
    endpoints?: {
      context_length?: number;
      supported_parameters?: string[];
    }[];
  };
  error?: { message?: string };
};

/**
 * Look a slug up on OpenRouter and derive its capabilities: input/output
 * modalities from the model's architecture, reasoning/tool support from the
 * union of its live endpoints' supported parameters. Throws with a plain
 * explanation for every way this can go sideways.
 */
async function detectFromOpenRouter(rawSlug: string): Promise<DetectedModel> {
  const slug = rawSlug.trim();
  if (!/^[\w.-]+\/[\w.:-]+$/.test(slug)) {
    throw new Error(
      `"${slug}" doesn't look like an OpenRouter slug — expected author/model, like "anthropic/claude-fable-5".`,
    );
  }

  let res: Response;
  try {
    res = await fetch(`${OPENROUTER_API_BASE}/models/${slug}/endpoints`);
  } catch {
    throw new Error("Couldn't reach OpenRouter — try again in a moment.");
  }
  if (res.status === 404) {
    throw new Error(
      `OpenRouter doesn't know "${slug}" — double-check the slug on openrouter.ai/models.`,
    );
  }

  const text = await res.text();
  let json: OpenRouterEndpointsResponse = {};
  try {
    json = text ? (JSON.parse(text) as OpenRouterEndpointsResponse) : {};
  } catch {
    // Non-JSON body — fall through to the status check below.
  }
  if (!res.ok) {
    const detail = json.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`OpenRouter said no: ${detail}`);
  }

  const data = json.data;
  if (!data) {
    throw new Error("OpenRouter returned an answer we couldn't parse.");
  }
  const endpoints = data.endpoints ?? [];
  if (endpoints.length === 0) {
    throw new Error(
      `"${slug}" exists but has no live endpoints on OpenRouter right now, so it can't serve traffic.`,
    );
  }

  const inputs = data.architecture?.input_modalities ?? [];
  const outputs = data.architecture?.output_modalities ?? [];
  const parameters = new Set(
    endpoints.flatMap((endpoint) => endpoint.supported_parameters ?? []),
  );
  const contextLength = Math.max(
    0,
    ...endpoints.map((endpoint) => endpoint.context_length ?? 0),
  );

  // OpenRouter names read "Anthropic: Claude Fable 5" — a ready-made
  // company/model split. Fall back to the slug's author segment when a name
  // skips the convention.
  const name = data.name ?? slug;
  const colonAt = name.indexOf(": ");
  const company =
    colonAt > 0 ? name.slice(0, colonAt) : (slug.split("/")[0] ?? slug);
  const modelName = colonAt > 0 ? name.slice(colonAt + 2) : name;

  return {
    slug: data.id ?? slug,
    company,
    modelName,
    description: data.description ?? "",
    capabilities: {
      vision: inputs.includes("image"),
      files: inputs.includes("file"),
      audio: inputs.includes("audio"),
      reasoning: parameters.has("reasoning"),
      tools: parameters.has("tools"),
      imageOutput: outputs.includes("image"),
      contextLength,
    },
  };
}

// --- Shared validation --------------------------------------------------------

function validateDetails(args: {
  displayName: string;
  company: string;
  modelName: string;
}): void {
  if (!args.displayName.trim()) throw new Error("Give the model a display name.");
  if (!args.company.trim()) throw new Error("Who makes this model?");
  if (!args.modelName.trim()) throw new Error("What's the model called?");
  for (const value of [args.displayName, args.company, args.modelName]) {
    if (value.length > MAX_NAME_LENGTH) {
      throw new Error(`Keep names under ${MAX_NAME_LENGTH} characters.`);
    }
  }
}

function validateIconSvg(iconSvg: string): void {
  if (!iconSvg.toLowerCase().includes("<svg")) {
    throw new Error("That icon doesn't look like an SVG.");
  }
  if (iconSvg.length > MAX_ICON_SVG_LENGTH) {
    throw new Error("Keep the icon under 32 KB.");
  }
}

// --- Public reads ---------------------------------------------------------------

function normalizeProviderName(name: string): string {
  return name.trim().toLowerCase();
}

async function readProviderIcons(db: DatabaseReader) {
  const rows = await db.query("modelProviders").take(MAX_PROVIDERS);
  return new Map(rows.map((row) => [row.normalizedName, row.iconSvg]));
}

/** The shape both apps consume: catalog entry or tier override. */
function publicModel(
  row: Doc<"models">,
  providerIcons: Map<string, string | undefined>,
) {
  const providerKey = normalizeProviderName(row.company);
  return {
    id: row._id,
    tier: row.tier,
    slug: row.slug,
    displayName: row.displayName,
    company: row.company,
    modelName: row.modelName,
    iconSvg: providerIcons.has(providerKey)
      ? providerIcons.get(providerKey)
      : row.iconSvg,
    capabilities: row.capabilities,
    // Search-only in the picker; the client sinks these below the rest.
    legacy: row.legacy === true,
    // Lets the picker order the catalog newest-first.
    createdAt: row.createdAt,
  };
}

/**
 * Everything the composer needs: enabled custom models for the search list
 * plus any tier overrides (for re-skinning the preset entries). Public —
 * it's the same catalog every user sees.
 */
export const listEnabled = query({
  args: {},
  handler: async (ctx) => {
    const [rows, providerIcons] = await Promise.all([
      ctx.db
        .query("models")
        .withIndex("by_enabled", (q) => q.eq("enabled", true))
        .take(MAX_MODELS),
      readProviderIcons(ctx.db),
    ]);
    return rows.map((row) => publicModel(row, providerIcons));
  },
});

/** The console's Models tab: every row, drafts included. Admin-only. */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    if (!(await isAdminIdentity(ctx))) return [];
    const [rows, providerIcons] = await Promise.all([
      ctx.db.query("models").take(MAX_MODELS),
      readProviderIcons(ctx.db),
    ]);
    return rows.map((row) => ({
      ...publicModel(row, providerIcons),
      enabled: row.enabled,
      updatedAt: row.updatedAt,
    }));
  },
});

/** Every provider currently used by a model, plus saved icon-only rows. */
export const listProviders = query({
  args: {},
  handler: async (ctx) => {
    if (!(await isAdminIdentity(ctx))) return [];
    const [models, providers] = await Promise.all([
      ctx.db.query("models").take(MAX_MODELS),
      ctx.db.query("modelProviders").take(MAX_PROVIDERS),
    ]);
    const byName = new Map<
      string,
      { name: string; iconSvg?: string; modelCount: number }
    >();
    for (const model of models) {
      const normalized = normalizeProviderName(model.company);
      const current = byName.get(normalized);
      byName.set(normalized, {
        name: current?.name ?? model.company,
        iconSvg: current?.iconSvg ?? model.iconSvg,
        modelCount: (current?.modelCount ?? 0) + 1,
      });
    }
    for (const provider of providers) {
      const current = byName.get(provider.normalizedName);
      byName.set(provider.normalizedName, {
        name: current?.name ?? provider.name,
        iconSvg: provider.iconSvg,
        modelCount: current?.modelCount ?? 0,
      });
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  },
});

// --- Admin actions ---------------------------------------------------------------

/**
 * Preview lookup for the console form: validates the slug against OpenRouter
 * and returns detected capabilities plus suggested names, without saving
 * anything.
 */
export const detect = action({
  args: { slug: v.string() },
  handler: async (ctx, args): Promise<DetectedModel> => {
    await requireAdmin(ctx);
    return await detectFromOpenRouter(args.slug);
  },
});

/**
 * Save a new custom model, or (with `tier`) customize a preset tier —
 * upserting, since a tier has at most one override. Capabilities are always
 * re-detected server-side; the form's preview is a convenience, not the
 * truth.
 */
export const create = action({
  args: {
    slug: v.string(),
    displayName: v.string(),
    company: v.string(),
    modelName: v.string(),
    tier: v.optional(tierValidator),
  },
  handler: async (ctx, args): Promise<Id<"models">> => {
    await requireAdmin(ctx);
    validateDetails(args);
    const detected = await detectFromOpenRouter(args.slug);
    return await ctx.runMutation(internal.models.insertInternal, {
      tier: args.tier,
      slug: detected.slug,
      displayName: args.displayName.trim(),
      company: args.company.trim(),
      modelName: args.modelName.trim(),
      capabilities: detected.capabilities,
    });
  },
});

/**
 * Edit an existing row. The slug is re-detected even when unchanged — cheap,
 * and it keeps capabilities honest if OpenRouter's listing moved under us.
 */
export const update = action({
  args: {
    id: v.id("models"),
    slug: v.string(),
    displayName: v.string(),
    company: v.string(),
    modelName: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireAdmin(ctx);
    validateDetails(args);
    const detected = await detectFromOpenRouter(args.slug);
    await ctx.runMutation(internal.models.updateInternal, {
      id: args.id,
      slug: detected.slug,
      displayName: args.displayName.trim(),
      company: args.company.trim(),
      modelName: args.modelName.trim(),
      capabilities: detected.capabilities,
    });
  },
});

/**
 * Validate every row against OpenRouter, then insert the whole JSON batch in
 * one mutation. Optional names override detected suggestions; omitted names
 * are filled from OpenRouter.
 */
export const bulkCreate = action({
  args: { models: v.array(bulkModelInputValidator) },
  handler: async (ctx, args): Promise<{ added: number }> => {
    await requireAdmin(ctx);
    if (args.models.length === 0) {
      throw new ConvexError("That file has no models.");
    }
    if (args.models.length > MAX_BULK_MODELS) {
      throw new ConvexError(
        `Import at most ${MAX_BULK_MODELS} models at a time.`,
      );
    }

    const rows: {
      slug: string;
      displayName: string;
      company: string;
      modelName: string;
      capabilities: ModelCapabilities;
    }[] = [];
    for (let i = 0; i < args.models.length; i += 5) {
      const batch = args.models.slice(i, i + 5);
      const detected = await Promise.all(
        batch.map(async (input) => {
          try {
            return {
              input,
              detected: await detectFromOpenRouter(input.slug),
            };
          } catch (cause) {
            throw new ConvexError(
              cause instanceof Error
                ? cause.message
                : `Couldn't validate "${input.slug}".`,
            );
          }
        }),
      );
      for (const { input, detected: result } of detected) {
        const details = {
          slug: result.slug,
          displayName: input.displayName?.trim() || result.modelName,
          company: input.company?.trim() || result.company,
          modelName: input.modelName?.trim() || result.modelName,
          capabilities: result.capabilities,
        };
        try {
          validateDetails(details);
        } catch (cause) {
          throw new ConvexError(
            cause instanceof Error
              ? `${result.slug}: ${cause.message}`
              : `Couldn't validate "${result.slug}".`,
          );
        }
        rows.push(details);
      }
    }

    const duplicate = rows.find(
      (row, index) => rows.findIndex((entry) => entry.slug === row.slug) !== index,
    );
    if (duplicate) {
      throw new ConvexError(
        `"${duplicate.slug}" appears more than once in the file.`,
      );
    }
    try {
      await ctx.runMutation(internal.models.insertManyInternal, { models: rows });
    } catch (cause) {
      throw new ConvexError(
        cause instanceof Error ? cause.message : "Couldn't add those models.",
      );
    }
    return { added: rows.length };
  },
});

// --- Admin mutations ---------------------------------------------------------------

/** Show or hide a custom model in the picker. Tier overrides have no draft
 * state — deleting the row is how they revert. */
export const setEnabled = mutation({
  args: { id: v.id("models"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("That model is gone already.");
    if (row.tier) {
      throw new Error(
        "Tier overrides are always live — reset the tier to default instead.",
      );
    }
    await ctx.db.patch(args.id, { enabled: args.enabled, updatedAt: Date.now() });
  },
});

/** Retire a custom model to search-only: it leaves the picker's browse
 * list but a typed search still finds it, and it keeps serving anyone who
 * already picked it. */
export const setLegacy = mutation({
  args: { id: v.id("models"), legacy: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("That model is gone already.");
    if (row.tier) {
      throw new Error(
        "Tier overrides can't retire — reset the tier to default instead.",
      );
    }
    await ctx.db.patch(args.id, { legacy: args.legacy, updatedAt: Date.now() });
  },
});

/** Delete a custom model, or reset an overridden tier back to its default. */
export const remove = mutation({
  args: { id: v.id("models") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(args.id);
    if (!row) return;
    await ctx.db.delete(args.id);
  },
});

/** Set or clear the icon shared by every model from a provider. */
export const setProviderIcon = mutation({
  args: {
    name: v.string(),
    iconSvg: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const name = args.name.trim();
    if (!name) throw new ConvexError("Give the provider a name.");
    if (name.length > MAX_NAME_LENGTH) {
      throw new ConvexError(`Keep names under ${MAX_NAME_LENGTH} characters.`);
    }
    if (args.iconSvg !== null) {
      try {
        validateIconSvg(args.iconSvg);
      } catch (cause) {
        throw new ConvexError(
          cause instanceof Error ? cause.message : "That icon isn't valid.",
        );
      }
    }
    const normalizedName = normalizeProviderName(name);
    const existing = await ctx.db
      .query("modelProviders")
      .withIndex("by_normalized_name", (q) =>
        q.eq("normalizedName", normalizedName),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        name,
        iconSvg: args.iconSvg ?? undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("modelProviders", {
        name,
        normalizedName,
        ...(args.iconSvg !== null ? { iconSvg: args.iconSvg } : {}),
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

// --- Internal plumbing ---------------------------------------------------------------

export const insertInternal = internalMutation({
  args: {
    tier: v.optional(tierValidator),
    slug: v.string(),
    displayName: v.string(),
    company: v.string(),
    modelName: v.string(),
    capabilities: modelCapabilitiesValidator,
  },
  handler: async (ctx, args): Promise<Id<"models">> => {
    const now = Date.now();
    if (args.slug.length > MAX_SLUG_LENGTH) {
      throw new Error(`Keep the slug under ${MAX_SLUG_LENGTH} characters.`);
    }

    // A tier has at most one override — saving again replaces it.
    if (args.tier) {
      const existing = await ctx.db
        .query("models")
        .withIndex("by_tier", (q) => q.eq("tier", args.tier))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          slug: args.slug,
          displayName: args.displayName,
          company: args.company,
          modelName: args.modelName,
          capabilities: args.capabilities,
          updatedAt: now,
        });
        return existing._id;
      }
    } else {
      await assertSlugAvailable(ctx.db, args.slug);
    }

    return await ctx.db.insert("models", {
      tier: args.tier,
      slug: args.slug,
      displayName: args.displayName,
      company: args.company,
      modelName: args.modelName,
      capabilities: args.capabilities,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateInternal = internalMutation({
  args: {
    id: v.id("models"),
    slug: v.string(),
    displayName: v.string(),
    company: v.string(),
    modelName: v.string(),
    capabilities: modelCapabilitiesValidator,
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("That model is gone already.");
    if (args.slug.length > MAX_SLUG_LENGTH) {
      throw new Error(`Keep the slug under ${MAX_SLUG_LENGTH} characters.`);
    }
    if (!row.tier && args.slug !== row.slug) {
      await assertSlugAvailable(ctx.db, args.slug);
    }
    await ctx.db.patch(args.id, {
      slug: args.slug,
      displayName: args.displayName,
      company: args.company,
      modelName: args.modelName,
      capabilities: args.capabilities,
      updatedAt: Date.now(),
    });
  },
});

export const insertManyInternal = internalMutation({
  args: {
    models: v.array(
      v.object({
        slug: v.string(),
        displayName: v.string(),
        company: v.string(),
        modelName: v.string(),
        capabilities: modelCapabilitiesValidator,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("models").take(MAX_MODELS + 1);
    if (existing.length + args.models.length > MAX_MODELS) {
      throw new Error(`The catalog can hold at most ${MAX_MODELS} models.`);
    }
    const now = Date.now();
    for (const model of args.models) {
      if (model.slug.length > MAX_SLUG_LENGTH) {
        throw new Error(`Keep the slug under ${MAX_SLUG_LENGTH} characters.`);
      }
      await assertSlugAvailable(ctx.db, model.slug);
      await ctx.db.insert("models", {
        ...model,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

async function assertSlugAvailable(
  db: DatabaseReader,
  slug: string,
): Promise<void> {
  const clashes = await db
    .query("models")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .take(OVERRIDABLE_TIERS.length + 1);
  if (clashes.some((row) => !row.tier)) {
    throw new Error(`"${slug}" is already in the catalog.`);
  }
}

// --- Inference-side reads ---------------------------------------------------------------

export type TierOverride = {
  slug: string;
  capabilities: ModelCapabilities;
};

// A wire model string that names a catalog model rather than a preset tier —
// OpenRouter slugs always carry a slash, tier keys never do. Shape-checked
// (same pattern the console validates against) so junk from a hand-crafted
// request never reaches an index lookup.
const CATALOG_SLUG_PATTERN = /^[\w.-]+\/[\w.:-]+$/;

export function isCatalogSlug(model: string | undefined): model is string {
  return (
    typeof model === "string" &&
    model.length <= MAX_SLUG_LENGTH &&
    CATALOG_SLUG_PATTERN.test(model)
  );
}

/**
 * The enabled catalog model behind a wire slug, or null when the slug isn't
 * one (a tier key), isn't in the catalog, or is currently disabled. Tier
 * override rows never match — they answer to their tier key, not their slug.
 */
export async function readCustomModel(
  db: DatabaseReader,
  model: string | undefined,
): Promise<TierOverride | null> {
  if (!isCatalogSlug(model)) return null;
  // The slug can be shared by up to one custom row plus a tier override per
  // overridable tier — scan the handful and keep the custom one.
  const rows = await db
    .query("models")
    .withIndex("by_slug", (q) => q.eq("slug", model))
    .take(OVERRIDABLE_TIERS.length + 1);
  const row = rows.find((entry) => entry.tier === undefined && entry.enabled);
  return row ? { slug: row.slug, capabilities: row.capabilities } : null;
}

// The tier keys a send may carry besides a catalog slug — the retired Pro
// included, since old clients can still echo it (the server folds it to Auto).
const WIRE_TIER_KEYS = new Set(["Auto", "Fast", "Basic", "Pro", "Max", "Image"]);

/**
 * What sendUserMessage persists as the turn's model: a known tier key rides
 * as-is, a catalog slug only while that model is live in the catalog, and
 * anything else quietly lands as Auto — a stale pick (deleted or disabled
 * model, hand-crafted key) reroutes instead of erroring, mirroring the
 * stream's own fallback.
 */
export async function resolveSendModel(
  db: DatabaseReader,
  model: string | undefined,
): Promise<string> {
  if (model === undefined || WIRE_TIER_KEYS.has(model)) return model ?? "Auto";
  return (await readCustomModel(db, model)) ? model : "Auto";
}

/**
 * The active override for a tier, or null to use the hardcoded default.
 * Accepts any model key so inference call sites don't need to pre-filter —
 * Auto (and the retired Pro) simply never match.
 */
export async function readTierOverride(
  db: DatabaseReader,
  modelKey: string,
): Promise<TierOverride | null> {
  if (!isOverridableTier(modelKey)) return null;
  const row = await db
    .query("models")
    .withIndex("by_tier", (q) => q.eq("tier", modelKey))
    .first();
  return row ? { slug: row.slug, capabilities: row.capabilities } : null;
}

/** Action-friendly wrapper around readTierOverride. */
export const tierOverrideInternal = internalQuery({
  args: { modelKey: v.string() },
  handler: async (ctx, args): Promise<TierOverride | null> => {
    return await readTierOverride(ctx.db, args.modelKey);
  },
});

// --- Free-tier restrictions ---------------------------------------------------

/** The tiers free users can't touch — the singleton row, or the built-in
 * default before an admin has ever toggled anything. */
export async function readRestrictedTiers(
  db: DatabaseReader,
): Promise<string[]> {
  const row = await db.query("tierAccess").first();
  return row ? row.restrictedTiers : DEFAULT_RESTRICTED_TIERS;
}

/** Public: both apps read this to draw locks and upgrade prompts. */
export const tierAccess = query({
  args: {},
  handler: async (ctx) => ({
    restrictedTiers: await readRestrictedTiers(ctx.db),
  }),
});

/** Flip one tier on or off the restriction list. Admin-only. */
export const setTierRestricted = mutation({
  args: { tier: v.string(), restricted: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (!(RESTRICTABLE_TIERS as readonly string[]).includes(args.tier)) {
      throw new Error(`"${args.tier}" isn't a tier we know.`);
    }
    const current = await readRestrictedTiers(ctx.db);
    const next = args.restricted
      ? [...new Set([...current, args.tier])]
      : current.filter((tier) => tier !== args.tier);
    const row = await ctx.db.query("tierAccess").first();
    if (row) {
      await ctx.db.patch(row._id, {
        restrictedTiers: next,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("tierAccess", {
        restrictedTiers: next,
        updatedAt: Date.now(),
      });
    }
  },
});

export type StreamModelConfig = {
  override: TierOverride | null;
  /** The enabled catalog model the wire string named, when it named one —
   * takes precedence over the tier override downstream. */
  custom: TierOverride | null;
  restricted: boolean;
};

/** Everything the stream needs about the requested model in one read: the
 * catalog model behind a wire slug (if any), the tier's admin override, and
 * whether the free plan may use it. Catalog models are always paid-only,
 * matching the client's model-access rules. */
export const streamModelConfigInternal = internalQuery({
  args: { modelKey: v.string(), wireModel: v.optional(v.string()) },
  handler: async (ctx, args): Promise<StreamModelConfig> => {
    const [custom, override, restrictedTiers] = await Promise.all([
      readCustomModel(ctx.db, args.wireModel),
      readTierOverride(ctx.db, args.modelKey),
      readRestrictedTiers(ctx.db),
    ]);
    return {
      override,
      custom,
      restricted: custom !== null || restrictedTiers.includes(args.modelKey),
    };
  },
});
