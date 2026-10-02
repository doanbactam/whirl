import { Autumn } from "autumn-js";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { decryptSecret, encryptSecret } from "./inference/crypto";
import { isPaidCustomer } from "./inference/billing";
import { mcpListTools, type McpHeader } from "./inference/mcp";
import { resolveBearer } from "./inference/mcpOAuth";
import { assertSafeFetchUrl } from "./inference/urlSafety";

// Caps so a user can't bloat a single row. Headers are small pairs (e.g.
// `Authorization: Bearer …`), so 10 is plenty. Server count is uncapped.
export const MAX_HEADERS_PER_SERVER = 10;
const MAX_NAME_LENGTH = 60;
const MAX_URL_LENGTH = 2048;
const MAX_HEADER_KEY_LENGTH = 120;
const MAX_HEADER_VALUE_LENGTH = 4096;

/** A header as the client sends it: a value of `undefined` means "keep the
 * existing one" (used when editing without re-typing a masked secret). */
const headerInputValidator = v.object({
  key: v.string(),
  value: v.optional(v.string()),
});

type HeaderInput = { key: string; value?: string };

/** What the client sees for a server: never any ciphertext or plaintext. */
type ServerView = {
  id: Id<"mcpServers">;
  name: string;
  url: string;
  enabled: boolean;
  // True for rows installed from the integration store — the settings list
  // shows those as integrations, not as hand-added servers.
  fromStore: boolean;
  authMode: "headers" | "oauth";
  headers: { key: string; hasValue: boolean }[];
  // OAuth status (no tokens/secrets): whether a valid grant is stored.
  oauthConnected: boolean;
  // The credential used to work and stopped — this row owes a reconnect.
  needsReauth: boolean;
  lastConnectedAt?: number;
  lastError?: string;
  updatedAt: number;
};

function toView(row: Doc<"mcpServers">): ServerView {
  return {
    id: row._id,
    name: row.name,
    url: row.url,
    enabled: row.enabled,
    fromStore: row.integrationId !== undefined,
    authMode: row.authMode ?? "headers",
    headers: (row.headers ?? []).map((h) => ({
      key: h.key,
      hasValue: h.valueCipher.length > 0,
    })),
    oauthConnected: row.oauth?.connected === true,
    needsReauth: row.authExpiredAt !== undefined,
    lastConnectedAt: row.lastConnectedAt,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

async function requireUserId(ctx: {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not authenticated");
  return identity.subject;
}

function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (url.length > MAX_URL_LENGTH) {
    throw new Error("That URL is too long.");
  }
  // Requires https and rejects internal hosts — secrets ride on this URL, and
  // we fetch it server-side, so plain http / private hosts aren't allowed.
  assertSafeFetchUrl(url);
  return url;
}

function normalizeName(raw: string): string {
  const name = raw.trim().slice(0, MAX_NAME_LENGTH);
  if (!name) throw new Error("Give the server a name.");
  return name;
}

/**
 * Build the stored header rows from client input, encrypting any newly supplied
 * value and reusing the existing ciphertext (matched by key) when the value was
 * left blank — so editing a server without re-typing a secret keeps it.
 */
async function buildHeaderRows(
  input: HeaderInput[] | undefined,
  existing: Doc<"mcpServers">["headers"],
): Promise<{ key: string; valueCipher: string }[]> {
  if (!input) return existing ?? [];
  const trimmed = input
    .map((h) => ({ key: h.key.trim(), value: h.value }))
    .filter((h) => h.key.length > 0)
    .slice(0, MAX_HEADERS_PER_SERVER);

  const existingByKey = new Map(
    (existing ?? []).map((h) => [h.key, h.valueCipher]),
  );

  const rows: { key: string; valueCipher: string }[] = [];
  for (const h of trimmed) {
    if (h.key.length > MAX_HEADER_KEY_LENGTH) {
      throw new Error("A header name is too long.");
    }
    if (h.value === undefined || h.value === "") {
      // Keep the existing secret for this key; skip the header entirely if it's
      // brand new with no value (nothing to store).
      const prior = existingByKey.get(h.key);
      if (prior) rows.push({ key: h.key, valueCipher: prior });
      continue;
    }
    if (h.value.length > MAX_HEADER_VALUE_LENGTH) {
      throw new Error("A header value is too long.");
    }
    rows.push({ key: h.key, valueCipher: await encryptSecret(h.value) });
  }
  return rows;
}

/** The signed-in user's MCP servers, without any secret values. */
export const listServers = query({
  args: {},
  handler: async (ctx): Promise<ServerView[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("mcpServers")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    return rows.sort((a, b) => a.createdAt - b.createdAt).map(toView);
  },
});

/** Add a remote MCP server for the signed-in user. */
export const addServer = mutation({
  args: {
    name: v.string(),
    url: v.string(),
    authMode: v.optional(v.union(v.literal("headers"), v.literal("oauth"))),
    headers: v.optional(v.array(headerInputValidator)),
  },
  handler: async (
    ctx,
    { name, url, authMode, headers },
  ): Promise<Id<"mcpServers">> => {
    const userId = await requireUserId(ctx);

    const mode = authMode ?? "headers";
    const now = Date.now();
    const id = await ctx.db.insert("mcpServers", {
      userId,
      name: normalizeName(name),
      url: normalizeUrl(url),
      enabled: true,
      authMode: mode,
      // OAuth servers carry no static headers; they authenticate via tokens.
      headers: mode === "oauth" ? [] : await buildHeaderRows(headers, undefined),
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});

/** Edit a server's name, URL, or headers. */
export const updateServer = mutation({
  args: {
    id: v.id("mcpServers"),
    name: v.optional(v.string()),
    url: v.optional(v.string()),
    headers: v.optional(v.array(headerInputValidator)),
  },
  handler: async (ctx, { id, name, url, headers }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) throw new Error("Server not found");

    const nextUrl = url !== undefined ? normalizeUrl(url) : undefined;
    const urlChanged = nextUrl !== undefined && nextUrl !== row.url;
    // An OAuth server's tokens are minted for a specific resource. If the URL
    // changes, the stored grant must not be reused — sending it to the new host
    // would leak a bearer token. Drop the grant and force a reconnect.
    const clearGrant =
      urlChanged && row.authMode === "oauth" && row.oauth !== undefined;

    await ctx.db.patch(id, {
      ...(name !== undefined ? { name: normalizeName(name) } : {}),
      ...(nextUrl !== undefined ? { url: nextUrl } : {}),
      ...(headers !== undefined
        ? { headers: await buildHeaderRows(headers, row.headers) }
        : {}),
      ...(clearGrant
        ? {
            oauth: {
              ...row.oauth!,
              accessTokenCipher: undefined,
              refreshTokenCipher: undefined,
              expiresAt: undefined,
              connected: false,
            },
            lastConnectedAt: undefined,
            lastError: undefined,
          }
        : {}),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Toggle a server on or off without deleting it. */
export const setServerEnabled = mutation({
  args: { id: v.id("mcpServers"), enabled: v.boolean() },
  handler: async (ctx, { id, enabled }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) throw new Error("Server not found");
    await ctx.db.patch(id, { enabled, updatedAt: Date.now() });
    return null;
  },
});

/** Delete a server. */
export const removeServer = mutation({
  args: { id: v.id("mcpServers") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) throw new Error("Server not found");
    await ctx.db.delete(id);
    return null;
  },
});

// --- Internal helpers used by the action + stream path ----------------------

/** Fetch one server row (with ciphertext) for an owner check inside an action. */
export const getServerInternal = internalQuery({
  args: { id: v.id("mcpServers") },
  handler: async (ctx, { id }): Promise<Doc<"mcpServers"> | null> => {
    return await ctx.db.get(id);
  },
});

/**
 * Persist the outcome of a connection attempt for the settings UI.
 *
 * A success clears any standing re-auth flag: whatever was wrong with the
 * credential isn't wrong now, and a row still shouting "sign-in expired" while
 * the model happily calls its tools is worse than no warning at all.
 */
export const recordConnectionResult = internalMutation({
  args: {
    id: v.id("mcpServers"),
    ok: v.boolean(),
    error: v.optional(v.string()),
    at: v.number(),
    /** The failure was a rejected credential, not a passing glitch. */
    authExpired: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ok, error, at, authExpired }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    await ctx.db.patch(id, {
      ...(ok ? { lastConnectedAt: at } : {}),
      lastError: ok ? undefined : (error ?? "Connection failed"),
      ...(ok
        ? { authExpiredAt: undefined }
        : authExpired
          ? { authExpiredAt: row.authExpiredAt ?? at }
          : {}),
      updatedAt: at,
    });
    return null;
  },
});

/**
 * Flag a server whose stored credential stopped being accepted.
 *
 * Called from the places that discover it in passing — a turn's OAuth refresh,
 * a dashboard's data binding — so the user finds out from the app rather than
 * from a page that renders nothing. Idempotent, and it keeps the FIRST time
 * the credential failed so "expired 3 days ago" stays true.
 */
export const markAuthExpired = internalMutation({
  args: {
    id: v.id("mcpServers"),
    reason: v.string(),
    at: v.number(),
  },
  handler: async (ctx, { id, reason, at }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    await ctx.db.patch(id, {
      authExpiredAt: row.authExpiredAt ?? at,
      lastError: reason.slice(0, 300),
      updatedAt: at,
    });
    return null;
  },
});

/**
 * Test a connection to an MCP server and list its tools. Accepts the URL and
 * headers currently in the form: a header with no `value` reuses the saved
 * secret for that key (so a masked, un-retyped value still works) when `id` is
 * given. Persists `lastConnectedAt` / `lastError` when testing a saved server.
 * Paid-only — the feature is gated like web search / memory.
 */
export const testConnection = action({
  args: {
    id: v.optional(v.id("mcpServers")),
    url: v.string(),
    headers: v.optional(v.array(headerInputValidator)),
  },
  handler: async (
    ctx,
    { id, url, headers },
  ): Promise<{
    ok: boolean;
    toolCount: number;
    tools: { name: string; description?: string }[];
    error?: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const customerId = identity.subject;

    const autumnSecretKey = process.env.AUTUMN_SECRET_KEY;
    if (autumnSecretKey) {
      const autumn = new Autumn({ secretKey: autumnSecretKey });
      const paid = await isPaidCustomer({ autumn, customerId });
      if (!paid) throw new Error("MCP servers are a paid feature.");
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeUrl(url);
    } catch (error) {
      return {
        ok: false,
        toolCount: 0,
        tools: [],
        error: error instanceof Error ? error.message : "Invalid URL",
      };
    }

    let row: Doc<"mcpServers"> | null = null;
    if (id) {
      row = await ctx.runQuery(internal.mcpServers.getServerInternal, { id });
      if (!row || row.userId !== customerId) {
        throw new Error("Server not found");
      }
    }

    const resolved: McpHeader[] = [];
    if (row?.authMode === "oauth") {
      // OAuth server: test with the stored grant, refreshing if it's stale.
      const o = row.oauth;
      if (!o || (!o.accessTokenCipher && !o.refreshTokenCipher)) {
        return {
          ok: false,
          toolCount: 0,
          tools: [],
          error: "Not connected yet. Click Connect to sign in first.",
        };
      }
      try {
        const bearer = await resolveBearer(
          {
            accessToken: o.accessTokenCipher
              ? await decryptSecret(o.accessTokenCipher)
              : undefined,
            refreshToken: o.refreshTokenCipher
              ? await decryptSecret(o.refreshTokenCipher)
              : undefined,
            expiresAt: o.expiresAt,
            tokenEndpoint: o.tokenEndpoint,
            clientId: o.clientId,
            clientSecret: o.clientSecretCipher
              ? await decryptSecret(o.clientSecretCipher)
              : undefined,
            resource: o.resource,
            scope: o.scope,
          },
          async (tokens) => {
            await ctx.runMutation(internal.mcpOAuthFlow.updateOAuthTokens, {
              serverId: id!,
              accessTokenCipher: await encryptSecret(tokens.accessToken),
              refreshTokenCipher: tokens.refreshToken
                ? await encryptSecret(tokens.refreshToken)
                : undefined,
              expiresAt: tokens.expiresAt,
            });
          },
        );
        if (bearer) resolved.push({ key: "Authorization", value: `Bearer ${bearer}` });
      } catch (error) {
        return {
          ok: false,
          toolCount: 0,
          tools: [],
          error:
            error instanceof Error
              ? `Sign-in expired: ${error.message}`
              : "Sign-in expired. Reconnect.",
        };
      }
    } else {
      // Headers mode: a provided value wins; an omitted one reuses the saved
      // ciphertext for the same key on the (owned) server being edited.
      const savedByKey = new Map(
        (row?.headers ?? []).map((h) => [h.key, h.valueCipher]),
      );
      for (const h of headers ?? []) {
        const key = h.key.trim();
        if (!key) continue;
        if (h.value !== undefined && h.value !== "") {
          resolved.push({ key, value: h.value });
        } else if (savedByKey.has(key)) {
          try {
            resolved.push({
              key,
              value: await decryptSecret(savedByKey.get(key)!),
            });
          } catch {
            // Skip a header we can't decrypt rather than failing the test.
          }
        }
      }
    }

    const at = Date.now();
    try {
      const tools = await mcpListTools(normalizedUrl, resolved);
      if (id) {
        await ctx.runMutation(internal.mcpServers.recordConnectionResult, {
          id,
          ok: true,
          at,
        });
      }
      return {
        ok: true,
        toolCount: tools.length,
        tools: tools.map((t) => ({
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
        })),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Connection failed";
      if (id) {
        await ctx.runMutation(internal.mcpServers.recordConnectionResult, {
          id,
          ok: false,
          error: message,
          at,
        });
      }
      return { ok: false, toolCount: 0, tools: [], error: message };
    }
  },
});
