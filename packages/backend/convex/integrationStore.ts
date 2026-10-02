import { Autumn } from "autumn-js";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  httpAction,
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import { createComposioConnectLink, isComposioAccountActive } from "./composio";
import { isPaidCustomer } from "./inference/billing";
import { encryptSecret } from "./inference/crypto";
import { callbackHtml } from "./mcpOAuthFlow";

// The user-facing side of the integration store: browsing approved
// integrations, installing one, and managing the installs. Registration and
// review live in convex/integrations.ts (the console backend); this file is
// what the Whirl app's /integrations page talks to.
//
// An install is just an `mcpServers` row with `integrationId` pointing back at
// the store listing — so installed integrations ride the exact same runtime
// path (tool discovery, OAuth, encrypted headers) as hand-added servers, and
// the existing mcpServers/mcpOAuthFlow mutations handle enable/disable,
// delete, and the OAuth consent flow.

const MAX_STORE_ENTRIES = 200;
const MAX_SECRET_VALUE_LENGTH = 4096;

/** Rows written before the approval workflow existed count as approved. */
function isApproved(row: Doc<"integrations">): boolean {
  return (row.status ?? "approved") === "approved";
}

/** Listable = approved by an admin, switched on by its developer, installable. */
function isListable(row: Doc<"integrations">): boolean {
  return isApproved(row) && row.enabled && Boolean(row.mcpUrl);
}

/** Composio listings whose toolkit needs an account run the hosted connect
 * flow at install time; no-auth toolkits (and everything else) don't. */
function needsComposioConnect(row: Doc<"integrations">): boolean {
  return Boolean(row.composio && row.composio.noAuth !== true);
}

/** Whether an install row is fully usable: Composio installs must have their
 * connected account ACTIVE; OAuth installs must hold a grant. */
function isInstallConnected(server: Doc<"mcpServers">): boolean {
  if (server.composio) return server.composio.connected;
  return server.authMode !== "oauth" || server.oauth?.connected === true;
}

/** The store-shopper's view of a listing: branding + auth recipe, no mcpUrl. */
async function toStoreEntry(ctx: QueryCtx, row: Doc<"integrations">) {
  return {
    id: row._id,
    name: row.name,
    description: row.description,
    author: row.author,
    // The shelf the browse page groups this listing under; null until the
    // classifier has been by (clients bucket that as "Everything else").
    category: row.category ?? null,
    verified: row.verified === true,
    logoUrl: row.logoId
      ? await ctx.storage.getUrl(row.logoId)
      : (row.logoUrl ?? null),
    bannerUrl: row.bannerId ? await ctx.storage.getUrl(row.bannerId) : null,
    iconSvg: row.iconSvg,
    authMode: row.authMode ?? "none",
    authFields: row.authFields ?? [],
    authInstructions: row.authInstructions,
    tools: row.tools ?? [],
    // True => installing pops Composio's hosted sign-in (like OAuth, minus
    // the MCP-spec dance). The client keys its install flow off this.
    composioConnect: needsComposioConnect(row),
  };
}

/** The signed-in user's install rows, keyed by store listing. */
async function installsByIntegration(ctx: QueryCtx, userId: string) {
  const servers = await ctx.db
    .query("mcpServers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const map = new Map<Id<"integrations">, Doc<"mcpServers">>();
  for (const server of servers) {
    if (server.integrationId) map.set(server.integrationId, server);
  }
  return map;
}

/**
 * The storefront: every approved + enabled integration, alphabetical, plus
 * (when signed in) whether the caller already has it installed.
 */
export const listStore = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("integrations")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .take(MAX_STORE_ENTRIES);
    const listable = rows.filter(isListable);
    listable.sort((a, b) => a.name.localeCompare(b.name));

    const identity = await ctx.auth.getUserIdentity();
    const installed = identity
      ? await installsByIntegration(ctx, identity.subject)
      : new Map<Id<"integrations">, Doc<"mcpServers">>();

    return Promise.all(
      listable.map(async (row) => {
        const server = installed.get(row._id);
        return {
          ...(await toStoreEntry(ctx, row)),
          installedServerId: server?._id ?? null,
          // An install the user never finished signing into (OAuth or
          // Composio connect) isn't "installed" yet — the UI offers to
          // resume the flow instead.
          installedConnected: server ? isInstallConnected(server) : false,
        };
      }),
    );
  },
});

/**
 * The caller's installed integrations for the manage tab: the install row
 * (enable/disable, OAuth status) joined with the listing's branding. A listing
 * that was deleted or unlisted after install still shows — the server row
 * keeps working — just with whatever branding survives.
 */
export const listInstalled = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const servers = await ctx.db
      .query("mcpServers")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    const installs = servers
      .filter((s) => s.integrationId)
      .sort((a, b) => b.createdAt - a.createdAt);
    return Promise.all(
      installs.map(async (server) => {
        const listing = await ctx.db.get(server.integrationId!);
        return {
          serverId: server._id,
          name: listing?.name ?? server.name,
          description: listing?.description,
          author: listing?.author,
          verified: listing?.verified === true,
          logoUrl: listing?.logoId
            ? await ctx.storage.getUrl(listing.logoId)
            : (listing?.logoUrl ?? null),
          iconSvg: listing?.iconSvg,
          // Developer-written action phrases per tool ("Searching your
          // issues") — chat shows these while the model runs the tool.
          tools: listing?.tools ?? [],
          authMode: listing?.authMode ?? "none",
          enabled: server.enabled,
          oauthConnected: server.oauth?.connected === true,
          // Composio installs: whether this row runs the hosted connect flow
          // and whether the user's account is linked yet.
          composioConnect: Boolean(server.composio),
          composioConnected: server.composio?.connected === true,
          // The credential used to work and stopped: a reconnect, not a
          // first-time setup, and the row says so in red.
          needsReauth: server.authExpiredAt !== undefined,
          authExpiredAt: server.authExpiredAt,
          lastError: server.lastError,
          installedAt: server.createdAt,
        };
      }),
    );
  },
});

// How many matches the suggestIntegrations chat tool gets back. These are the
// model's shortlist, not the user's — it reads them as text and cards exactly
// one — so the ceiling is about keeping the tool result small, not about
// keeping the screen tidy.
const SUGGESTION_LIMIT = 6;

/**
 * Rank listings against a capability query for the chat's suggestIntegrations
 * tool. Name hits beat description hits beat tool-blurb hits; verified
 * listings break ties. An empty query means "show me what's around" — the
 * verified shelf, alphabetical.
 */
function scoreListing(row: Doc<"integrations">, tokens: string[]): number {
  if (tokens.length === 0) return row.verified === true ? 1 : 0.5;
  const name = row.name.toLowerCase();
  const description = row.description?.toLowerCase() ?? "";
  const author = row.author?.toLowerCase() ?? "";
  const toolText = (row.tools ?? [])
    .map((t) => `${t.name} ${t.description}`)
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (name.includes(token)) score += 6;
    if (description.includes(token)) score += 3;
    if (toolText.includes(token)) score += 2;
    if (author.includes(token)) score += 1;
  }
  if (score > 0 && row.verified === true) score += 0.5;
  return score;
}

/**
 * The chat model's window into the store (via the suggestIntegrations tool):
 * approved + enabled listings ranked against a capability query, each flagged
 * with whether this user already has it installed. Internal — the stream
 * action passes the userId it authenticated itself.
 */
export const searchForSuggestion = internalQuery({
  args: {
    userId: v.string(),
    query: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("integrations")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .take(MAX_STORE_ENTRIES);
    const tokens = args.query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1);
    const ranked = rows
      .filter(isListable)
      .map((row) => ({ row, score: scoreListing(row, tokens) }))
      .filter(({ score }) => score > 0)
      .sort(
        (a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name),
      )
      .slice(0, SUGGESTION_LIMIT);

    const installed = await installsByIntegration(ctx, args.userId);
    return ranked.map(({ row }) => ({
      integrationId: row._id,
      name: row.name,
      description: row.description,
      author: row.author,
      verified: row.verified === true,
      authMode: row.authMode ?? "none",
      needsSignIn: (row.authMode ?? "none") === "oauth" || needsComposioConnect(row),
      installed: installed.has(row._id),
    }));
  },
});

/**
 * Hydrates the chat's inline suggestion cards: the listed subset of store
 * entries by id, in the same shape as listStore, plus the caller's install
 * state (reactive — installing from the card flips it to "Installed" live).
 * Listings that were unlisted since the suggestion was made just drop out.
 */
export const listSuggested = query({
  args: { ids: v.array(v.id("integrations")) },
  handler: async (ctx, args) => {
    const rows = await Promise.all(
      args.ids.slice(0, SUGGESTION_LIMIT).map((id) => ctx.db.get(id)),
    );
    const listable = rows.filter(
      (row): row is Doc<"integrations"> => row !== null && isListable(row),
    );

    const identity = await ctx.auth.getUserIdentity();
    const installed = identity
      ? await installsByIntegration(ctx, identity.subject)
      : new Map<Id<"integrations">, Doc<"mcpServers">>();

    return Promise.all(
      listable.map(async (row) => {
        const server = installed.get(row._id);
        return {
          ...(await toStoreEntry(ctx, row)),
          installedServerId: server?._id ?? null,
          installedConnected: server ? isInstallConnected(server) : false,
        };
      }),
    );
  },
});

/**
 * Install a store integration: create the linked `mcpServers` row. For
 * "apiKey" listings, `secrets` carries the user's value for each auth field —
 * encrypted here and stored as headers, never returned to any client. OAuth
 * listings connect afterwards via the standard mcpOAuthFlow:startOAuth popup.
 *
 * An action so it can ask Autumn about the caller's plan — integrations are
 * paid-only, enforced here (and again at runtime in the stream), with the
 * client's upgrade modal as mere UX on top. The write itself happens in
 * `installInternal` below.
 */
export const install = action({
  args: {
    id: v.id("integrations"),
    secrets: v.optional(
      v.array(v.object({ key: v.string(), value: v.string() })),
    ),
  },
  handler: async (ctx, args): Promise<{ serverId: Id<"mcpServers"> }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    // Same gate as mcpServers.testConnection / mcpOAuthFlow.startOAuth: skip
    // only when Autumn isn't configured (local dev without billing).
    const autumnSecretKey = process.env.AUTUMN_SECRET_KEY;
    if (autumnSecretKey) {
      const autumn = new Autumn({ secretKey: autumnSecretKey });
      const paid = await isPaidCustomer({
        autumn,
        customerId: identity.subject,
      });
      if (!paid) throw new Error("Integrations are a paid feature.");
    }

    return ctx.runMutation(internal.integrationStore.installInternal, args);
  },
});

/** The install write, called from the paid-gated `install` action above. */
export const installInternal = internalMutation({
  args: {
    id: v.id("integrations"),
    secrets: v.optional(
      v.array(v.object({ key: v.string(), value: v.string() })),
    ),
  },
  handler: async (ctx, args): Promise<{ serverId: Id<"mcpServers"> }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject;

    const row = await ctx.db.get(args.id);
    if (!row || !isListable(row)) {
      throw new Error("That integration isn't available right now.");
    }

    const servers = await ctx.db
      .query("mcpServers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (servers.some((s) => s.integrationId === args.id)) {
      throw new Error("You already have this integration installed.");
    }

    const authMode = row.authMode ?? "none";
    const headers: { key: string; valueCipher: string }[] = [];
    if (authMode === "apiKey") {
      const provided = new Map(
        (args.secrets ?? []).map((s) => [s.key, s.value]),
      );
      for (const field of row.authFields ?? []) {
        const value = provided.get(field.key)?.trim();
        if (!value) throw new Error(`Fill in "${field.label}" first.`);
        if (value.length > MAX_SECRET_VALUE_LENGTH) {
          throw new Error(`"${field.label}" is too long.`);
        }
        headers.push({
          key: field.key,
          valueCipher: await encryptSecret(value),
        });
      }
    }

    // Composio-backed extensions connect per user: the server URL carries the
    // installer's id (Composio keys connected accounts off it), and our org
    // API key rides along as an encrypted header like any other integration
    // secret. Account linking happens right after this write, via the hosted
    // connect popup (startComposioConnect below) — until it completes the
    // install stays composio.connected=false and out of the model's reach.
    let url = row.mcpUrl!;
    if (row.composio) {
      const composioKey = process.env.COMPOSIO_API_KEY;
      if (composioKey) {
        headers.push({
          key: "x-api-key",
          valueCipher: await encryptSecret(composioKey),
        });
      }
      const separator = url.includes("?") ? "&" : "?";
      url = `${url}${separator}user_id=${encodeURIComponent(userId)}`;
    }

    const now = Date.now();
    const serverId = await ctx.db.insert("mcpServers", {
      userId,
      name: row.name,
      url,
      enabled: true,
      integrationId: args.id,
      authMode: authMode === "oauth" ? "oauth" : "headers",
      headers,
      composio: needsComposioConnect(row) ? { connected: false } : undefined,
      createdAt: now,
      updatedAt: now,
    });
    return { serverId };
  },
});

// --- Composio account connect (install-time auth) -----------------------------
//
// Composio's MCP servers don't speak MCP-spec OAuth — auth is a "connected
// account" Composio manages per user. So instead of mcpOAuthFlow's DCR dance,
// connecting is: mint a hosted link (fresh each click; link sessions expire),
// open it in the same popup UX, and let the callback below verify with
// Composio that the account went ACTIVE before flipping the install on.

/**
 * Mint a hosted Composio sign-in link for an install and remember which
 * connected account to watch. The client opens the URL in the OAuth popup.
 */
export const startComposioConnect = action({
  args: { id: v.id("mcpServers") },
  handler: async (ctx, args): Promise<{ redirectUrl: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const server: Doc<"mcpServers"> | null = await ctx.runQuery(
      internal.mcpServers.getServerInternal,
      { id: args.id },
    );
    if (!server || server.userId !== identity.subject) {
      throw new Error("Server not found");
    }
    if (!server.integrationId || !server.composio) {
      throw new Error("This integration doesn't use Composio sign-in.");
    }
    const listing: Doc<"integrations"> | null = await ctx.runQuery(
      internal.composio.getListing,
      { id: server.integrationId },
    );
    if (!listing?.composio) {
      throw new Error("That integration isn't available right now.");
    }

    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) throw new Error("CONVEX_SITE_URL is not configured.");
    // The server id in the callback URL only tells the callback which row to
    // re-check — connection state is verified against Composio, not the URL.
    const callbackUrl = `${siteUrl}/composio/oauth/callback?server=${args.id}`;

    const link = await createComposioConnectLink(
      listing.composio.authConfigId,
      identity.subject,
      callbackUrl,
    );
    await ctx.runMutation(internal.integrationStore.setComposioAccount, {
      serverId: args.id,
      connectedAccountId: link.connectedAccountId,
    });
    return { redirectUrl: link.redirectUrl };
  },
});

/** Remember the connected account a fresh link session created. */
export const setComposioAccount = internalMutation({
  args: {
    serverId: v.id("mcpServers"),
    connectedAccountId: v.string(),
  },
  handler: async (ctx, args) => {
    const server = await ctx.db.get(args.serverId);
    if (!server?.composio) return null;
    await ctx.db.patch(args.serverId, {
      composio: {
        connectedAccountId: args.connectedAccountId,
        connected: false,
      },
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Flip the install live once Composio confirms the account is ACTIVE. */
export const markComposioConnected = internalMutation({
  args: { serverId: v.id("mcpServers") },
  handler: async (ctx, args) => {
    const server = await ctx.db.get(args.serverId);
    if (!server?.composio) return null;
    await ctx.db.patch(args.serverId, {
      composio: { ...server.composio, connected: true },
      lastConnectedAt: Date.now(),
      lastError: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Where Composio's hosted flow sends the user afterwards. Not authenticated —
 * the `server` param is only a pointer at which install to re-check, and the
 * connected flag flips solely on Composio's word that the account is ACTIVE
 * (asked over our API key), so a forged call can't connect anything.
 */
export const composioOAuthCallback = httpAction(async (ctx, request) => {
  const respond = (payload: { ok: boolean; error?: string; name?: string }) =>
    new Response(callbackHtml(payload), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

  const serverParam = new URL(request.url).searchParams.get("server");
  if (!serverParam) return respond({ ok: false, error: "Missing install." });

  let server: Doc<"mcpServers"> | null = null;
  try {
    server = await ctx.runQuery(internal.mcpServers.getServerInternal, {
      id: serverParam as Id<"mcpServers">,
    });
  } catch {
    // Garbage id — fall through to the shared error below.
  }
  if (!server?.composio?.connectedAccountId) {
    return respond({
      ok: false,
      error: "This connect link doesn't match a pending install.",
    });
  }

  try {
    const active = await isComposioAccountActive(
      server.composio.connectedAccountId,
    );
    if (!active) {
      return respond({
        ok: false,
        error: "The sign-in didn't finish — try connecting again.",
      });
    }
    await ctx.runMutation(internal.integrationStore.markComposioConnected, {
      serverId: server._id,
    });
    return respond({ ok: true, name: server.name });
  } catch (error) {
    return respond({
      ok: false,
      error:
        error instanceof Error ? error.message : "Couldn't verify the sign-in.",
    });
  }
});
