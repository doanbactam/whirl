import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import {
  argsCacheKey,
  artifactScope,
  chartScope,
  parseArgsObject,
  parseBindingPayload,
  readDeclaredSource,
  BINDING_MAX_RESULT_CHARS,
} from "./inference/bindingRead";
import { applyChartBinding } from "./inference/chartBinding";
import { resolveMcpServerConfigs, type StoredMcpServer } from "./inference/mcpResolve";
import type { ArtifactBinding } from "./validators";

/**
 * Running declared data bindings — for a react artifact, and for a live chart.
 *
 * Neither caller can reach an integration itself. A react artifact runs in an
 * opaque-origin iframe with no network; a chart card is just a phase on a
 * message. Both ask the host for a binding BY ID, and this is where that id is
 * turned back into the integration and tool the model declared when it wrote
 * the thing. Nothing on the client side ever names either one, so a page (or
 * a chart) built to show open issues cannot decide to go read the mail.
 *
 * Two limits sit in front of every live call, because the callers are React
 * components and React components re-render:
 *  - a per-(scope, binding, args) cache with a short TTL, so a repeated read
 *    is served from the last result instead of the integration, and
 *  - a rolling per-scope ceiling, for the caller that varies its parameters
 *    every frame and so never hits the cache.
 */

/** How long a successful binding result stands in for the live integration. */
const CACHE_TTL_MS = 60_000;
/**
 * How long a FAILED read is remembered.
 *
 * Much shorter, and the difference is load-bearing: a failure cached for a
 * full minute meant the artifact's own retry button did nothing for a minute.
 * Long enough to absorb a re-render storm, short enough that "try again"
 * means something.
 */
const FAILURE_CACHE_TTL_MS = 8_000;
/** Rolling window for the per-scope call ceiling. */
const RATE_WINDOW_MS = 60_000;
/** Live integration calls one scope may make per window. */
const MAX_CALLS_PER_WINDOW = 20;
/** Extra arguments a refetch may add. */
const MAX_EXTRA_ARGS_CHARS = 4_000;

export type BindingRunResult =
  | { ok: true; data: unknown; fetchedAt: number; cached: boolean }
  | { ok: false; error: string };

export type ChartBindingRunResult =
  | {
      ok: true;
      categories: string[];
      series: { name: string; values?: (number | null)[] }[];
      fetchedAt: number;
      cached: boolean;
    }
  | { ok: false; error: string };

/* --- internals ------------------------------------------------------------- */

/** The user's callable servers. Shared by both entry points. */
export const userServers = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const servers = await ctx.db
      .query("mcpServers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return servers
      .filter((s) => s.enabled && (!s.composio || s.composio.connected))
      .map((s) => ({
        id: s._id as string,
        name: s.name,
        url: s.url,
        authMode: s.authMode ?? "headers",
        headers: (s.headers ?? []).map((h) => ({
          key: h.key,
          valueCipher: h.valueCipher,
        })),
        oauth: s.oauth,
      })) satisfies StoredMcpServer[];
  },
});

/** The artifact's declared bindings, if the caller owns it. */
export const artifactBindings = internalQuery({
  args: { htmlId: v.id("htmlArtifacts"), userId: v.string() },
  handler: async (ctx, { htmlId, userId }) => {
    const row = await ctx.db.get(htmlId);
    if (!row || row.userId !== userId) return null;
    return row.bindings ?? [];
  },
});

/** One chart phase's binding, if the caller owns the message it sits on. */
export const chartBinding = internalQuery({
  args: {
    messageId: v.id("messages"),
    phaseIndex: v.number(),
    userId: v.string(),
  },
  handler: async (ctx, { messageId, phaseIndex, userId }) => {
    const message = await ctx.db.get(messageId);
    if (!message || message.userId !== userId) return null;
    const phase = message.phases?.[phaseIndex];
    if (!phase || phase.kind !== "chart") return null;
    return phase.chart?.binding ?? null;
  },
});

export const readCachedBinding = internalQuery({
  args: { scope: v.string(), bindingId: v.string(), argsKey: v.string() },
  handler: async (ctx, { scope, bindingId, argsKey }) =>
    await ctx.db
      .query("artifactBindingCache")
      .withIndex("by_binding", (q) =>
        q.eq("scope", scope).eq("bindingId", bindingId).eq("argsKey", argsKey),
      )
      .unique(),
});

export const writeCachedBinding = internalMutation({
  args: {
    scope: v.string(),
    bindingId: v.string(),
    argsKey: v.string(),
    value: v.string(),
    ok: v.boolean(),
  },
  handler: async (ctx, { scope, bindingId, argsKey, value, ok }) => {
    const existing = await ctx.db
      .query("artifactBindingCache")
      .withIndex("by_binding", (q) =>
        q.eq("scope", scope).eq("bindingId", bindingId).eq("argsKey", argsKey),
      )
      .unique();
    const fetchedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { value, ok, fetchedAt });
    } else {
      await ctx.db.insert("artifactBindingCache", {
        scope,
        bindingId,
        argsKey,
        value,
        ok,
        fetchedAt,
      });
    }
    return fetchedAt;
  },
});

/**
 * Seed an artifact's cache with the reads its authoring pass already made.
 *
 * The tool runs every declared binding once before the artifact is finalized
 * (that's what keeps a wrong tool name from shipping), and throwing those
 * responses away would mean the very first paint refetches all of them. This
 * hands them straight to the frame instead: a dashboard with live data opens
 * showing it, rather than opening on five spinners.
 */
export const seedArtifactBindings = internalMutation({
  args: {
    htmlId: v.id("htmlArtifacts"),
    entries: v.array(
      v.object({
        bindingId: v.string(),
        /** The binding's declared args, JSON-encoded, exactly as stored. */
        args: v.optional(v.string()),
        value: v.string(),
      }),
    ),
  },
  handler: async (ctx, { htmlId, entries }) => {
    const scope = artifactScope(htmlId);
    const fetchedAt = Date.now();
    for (const { bindingId, args, value } of entries) {
      const argsKey = argsCacheKey(parseArgsObject(args));
      const existing = await ctx.db
        .query("artifactBindingCache")
        .withIndex("by_binding", (q) =>
          q.eq("scope", scope).eq("bindingId", bindingId).eq("argsKey", argsKey),
        )
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { value, ok: true, fetchedAt });
      } else {
        await ctx.db.insert("artifactBindingCache", {
          scope,
          bindingId,
          argsKey,
          value,
          ok: true,
          fetchedAt,
        });
      }
    }
    return null;
  },
});

/**
 * Claim one slot in the scope's rolling call budget. Returns false when the
 * window is spent — the caller then serves a stale cache entry if it has one,
 * or reports the throttle honestly if it doesn't.
 */
export const claimBindingCall = internalMutation({
  args: { scope: v.string() },
  handler: async (ctx, { scope }) => {
    const now = Date.now();
    const usage = await ctx.db
      .query("artifactBindingUsage")
      .withIndex("by_scope", (q) => q.eq("scope", scope))
      .unique();

    if (!usage) {
      await ctx.db.insert("artifactBindingUsage", {
        scope,
        windowStart: now,
        count: 1,
      });
      return true;
    }
    if (now - usage.windowStart >= RATE_WINDOW_MS) {
      await ctx.db.patch(usage._id, { windowStart: now, count: 1 });
      return true;
    }
    if (usage.count >= MAX_CALLS_PER_WINDOW) return false;
    await ctx.db.patch(usage._id, { count: usage.count + 1 });
    return true;
  },
});

/* --- the actions ----------------------------------------------------------- */

/**
 * Run one binding for its owner. Never throws at the caller: a component
 * asking for data gets `{ ok: false, error }` and renders its error state,
 * because a rejected promise inside a sandboxed frame is a blank card with no
 * explanation.
 */
export const runBinding = action({
  args: {
    htmlId: v.id("htmlArtifacts"),
    bindingId: v.string(),
    /** JSON-encoded extra arguments from refetch(), merged over the declared ones. */
    extraArgs: v.optional(v.string()),
    /** A user-initiated refresh: skip the cache, still spend from the budget. */
    force: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { htmlId, bindingId, extraArgs, force },
  ): Promise<BindingRunResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const bindings = await ctx.runQuery(internal.artifactData.artifactBindings, {
      htmlId,
      userId: identity.subject,
    });
    if (!bindings) {
      return { ok: false, error: "This artifact isn't available anymore." };
    }
    const binding = (bindings as ArtifactBinding[]).find(
      (b) => b.id === bindingId,
    );
    if (!binding) {
      return {
        ok: false,
        error: `This artifact has no data source called "${bindingId}".`,
      };
    }

    const raw = await runDeclaredBinding(ctx, {
      scope: artifactScope(htmlId),
      userId: identity.subject,
      binding,
      extraArgs,
      ...(force ? { skipCache: true } : {}),
    });
    if (!raw.ok) return raw;

    const parsed = payloadOf(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return {
      ok: true,
      data: parsed.data,
      fetchedAt: raw.fetchedAt,
      cached: raw.cached,
    };
  },
});

/**
 * Run a live chart's binding and map the response into series.
 *
 * The mapping is applied server-side, with the same code the tool validated it
 * with at authoring time — so a chart that drew correctly once cannot start
 * silently mis-reading a response later.
 */
export const runChartBinding = action({
  args: {
    messageId: v.id("messages"),
    phaseIndex: v.number(),
    /** An explicit refresh means now, not "within the last minute" — skip the
     *  cache, but still spend from the same budget. */
    force: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { messageId, phaseIndex, force },
  ): Promise<ChartBindingRunResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const binding = await ctx.runQuery(internal.artifactData.chartBinding, {
      messageId,
      phaseIndex,
      userId: identity.subject,
    });
    if (!binding) {
      return { ok: false, error: "This chart's data source isn't available." };
    }

    const raw = await runDeclaredBinding(ctx, {
      scope: chartScope(messageId, phaseIndex),
      userId: identity.subject,
      binding: {
        id: "chart",
        integration: binding.integration,
        tool: binding.tool,
        ...(binding.args ? { args: binding.args } : {}),
      },
      ...(force ? { skipCache: true } : {}),
    });
    if (!raw.ok) return raw;

    const parsed = payloadOf(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };

    const mapped = applyChartBinding(parsed.data, {
      ...(binding.path ? { path: binding.path } : {}),
      categoryField: binding.categoryField,
      ...(binding.valueFields ? { valueFields: binding.valueFields } : {}),
      ...(binding.aggregate ? { aggregate: binding.aggregate } : {}),
      ...(binding.limit !== undefined ? { limit: binding.limit } : {}),
    });
    if (!mapped.ok) return { ok: false, error: mapped.error };

    return {
      ok: true,
      categories: mapped.data.categories,
      series: mapped.data.series,
      fetchedAt: raw.fetchedAt,
      cached: raw.cached,
    };
  },
});

/* --- the shared run path --------------------------------------------------- */

type RawBindingResult =
  | {
      ok: true;
      text: string;
      /** Present on a fresh read — already parsed, so nobody parses twice. */
      data?: unknown;
      fetchedAt: number;
      cached: boolean;
    }
  | { ok: false; error: string };

/** The payload for a raw result, parsing the cached text only when it must. */
function payloadOf(
  raw: Extract<RawBindingResult, { ok: true }>,
): { ok: true; data: unknown } | { ok: false; error: string } {
  return "data" in raw
    ? { ok: true, data: raw.data }
    : parseBindingPayload(raw.text);
}

/**
 * Cache, budget, call, cache. Every read an artifact or a chart makes goes
 * through here, so the two can't drift on limits or on failure copy.
 */
async function runDeclaredBinding(
  ctx: ActionCtx,
  {
    scope,
    userId,
    binding,
    extraArgs,
    skipCache = false,
  }: {
    scope: string;
    userId: string;
    binding: ArtifactBinding;
    extraArgs?: string;
    /** An explicit user refresh: read live, but still spend from the budget. */
    skipCache?: boolean;
  },
): Promise<RawBindingResult> {
  const args = {
    ...parseArgsObject(binding.args),
    ...parseArgsObject(
      extraArgs && extraArgs.length <= MAX_EXTRA_ARGS_CHARS
        ? extraArgs
        : undefined,
    ),
  };
  const argsKey = argsCacheKey(args);
  const bindingId = binding.id;

  const cached = await ctx.runQuery(internal.artifactData.readCachedBinding, {
    scope,
    bindingId,
    argsKey,
  });
  const cacheAge = cached ? Date.now() - cached.fetchedAt : Infinity;
  const cacheTtl = cached?.ok ? CACHE_TTL_MS : FAILURE_CACHE_TTL_MS;
  if (!skipCache && cached && cacheAge < cacheTtl) {
    return cached.ok
      ? {
          ok: true,
          text: cached.value,
          fetchedAt: cached.fetchedAt,
          cached: true,
        }
      : { ok: false, error: cached.value };
  }

  const allowed = await ctx.runMutation(internal.artifactData.claimBindingCall, {
    scope,
  });
  if (!allowed) {
    // Out of budget. A stale result beats an error message, so serve it and
    // let the caller say when it came from; only an empty cache fails.
    if (cached?.ok) {
      return {
        ok: true,
        text: cached.value,
        fetchedAt: cached.fetchedAt,
        cached: true,
      };
    }
    return {
      ok: false,
      error: "This is asking for data too often. It will work again in a minute.",
    };
  }

  const stored = await ctx.runQuery(internal.artifactData.userServers, {
    userId,
  });
  const servers = await resolveMcpServerConfigs(stored, {
    persistRefreshedTokens: async (tokens) => {
      await ctx.runMutation(internal.mcpOAuthFlow.updateOAuthTokens, {
        serverId: tokens.serverId as Id<"mcpServers">,
        accessTokenCipher: tokens.accessTokenCipher,
        refreshTokenCipher: tokens.refreshTokenCipher,
        expiresAt: tokens.expiresAt,
      });
    },
    // A dashboard is often the first thing to notice a dead grant, hours
    // after the chat that built it. Record it so the user is told where
    // integrations live, instead of staring at an empty card.
    onAuthExpired: async ({ serverId, reason }) => {
      await ctx.runMutation(internal.mcpServers.markAuthExpired, {
        id: serverId as Id<"mcpServers">,
        reason,
        at: Date.now(),
      });
    },
  });

  const result = await readDeclaredSource({
    servers,
    integration: binding.integration,
    tool: binding.tool,
    args,
    maxChars: BINDING_MAX_RESULT_CHARS,
  });

  if (!result.ok) {
    // A missing integration is a state of the account, not of the data: it
    // flips the instant the user reconnects, so remembering it would just
    // make the fix look like it didn't work. Everything else gets the short
    // failure TTL, which is enough to absorb a remount storm.
    if (result.kind !== "not-connected") {
      await ctx.runMutation(internal.artifactData.writeCachedBinding, {
        scope,
        bindingId,
        argsKey,
        value: result.error,
        ok: false,
      });
    }
    return { ok: false, error: result.error };
  }

  const fetchedAt = await ctx.runMutation(
    internal.artifactData.writeCachedBinding,
    { scope, bindingId, argsKey, value: result.text, ok: true },
  );
  return {
    ok: true,
    text: result.text,
    data: result.data,
    fetchedAt,
    cached: false,
  };
}
