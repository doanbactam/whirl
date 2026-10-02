import { Autumn } from "autumn-js";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  httpAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { decryptSecret, encryptSecret } from "./inference/crypto";
import { isPaidCustomer } from "./inference/billing";
import {
  buildAuthorizationUrl,
  codeChallengeS256,
  discoverAndRegister,
  exchangeCode,
  randomToken,
} from "./inference/mcpOAuth";
import { siteUrl } from "./site";

// The OAuth side of MCP servers: Dynamic Client Registration, the
// authorization-code + PKCE flow, the redirect callback, and token refresh.
// The CRUD + the OAuth protocol primitives live elsewhere (mcpServers.ts and
// inference/mcpOAuth.ts respectively); this file is just the Convex functions
// that drive the flow against the `mcpServers` / `mcpOAuthFlows` tables.

/** Persist the registered client + endpoints and open a fresh PKCE flow row. */
export const beginOAuthFlow = internalMutation({
  args: {
    serverId: v.id("mcpServers"),
    state: v.string(),
    codeVerifier: v.string(),
    redirectUri: v.string(),
    clientId: v.string(),
    clientSecretCipher: v.optional(v.string()),
    authorizationEndpoint: v.string(),
    tokenEndpoint: v.string(),
    registrationEndpoint: v.optional(v.string()),
    scope: v.optional(v.string()),
    resource: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const server = await ctx.db.get(args.serverId);
    if (!server) throw new Error("Server not found");

    await ctx.db.patch(args.serverId, {
      authMode: "oauth",
      oauth: {
        clientId: args.clientId,
        clientSecretCipher: args.clientSecretCipher,
        authorizationEndpoint: args.authorizationEndpoint,
        tokenEndpoint: args.tokenEndpoint,
        registrationEndpoint: args.registrationEndpoint,
        scope: args.scope,
        resource: args.resource,
        connected: false,
      },
      lastError: undefined,
      updatedAt: Date.now(),
    });

    // Drop any prior in-flight flows for this server before opening a new one.
    const stale = await ctx.db
      .query("mcpOAuthFlows")
      .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
      .collect();
    await Promise.all(stale.map((row) => ctx.db.delete(row._id)));

    await ctx.db.insert("mcpOAuthFlows", {
      userId: server.userId,
      serverId: args.serverId,
      state: args.state,
      codeVerifier: args.codeVerifier,
      redirectUri: args.redirectUri,
      createdAt: Date.now(),
    });
    return null;
  },
});

/** Look up an in-flight flow (and its server) by the OAuth `state` param. */
export const getFlowAndServer = internalQuery({
  args: { state: v.string() },
  handler: async (
    ctx,
    { state },
  ): Promise<{
    flow: Doc<"mcpOAuthFlows">;
    server: Doc<"mcpServers">;
  } | null> => {
    const flow = await ctx.db
      .query("mcpOAuthFlows")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (!flow) return null;
    const server = await ctx.db.get(flow.serverId);
    if (!server) return null;
    return { flow, server };
  },
});

/** Store the freshly exchanged tokens on the server and close the flow. */
export const completeOAuth = internalMutation({
  args: {
    flowId: v.id("mcpOAuthFlows"),
    serverId: v.id("mcpServers"),
    accessTokenCipher: v.string(),
    refreshTokenCipher: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { flowId, serverId, accessTokenCipher, refreshTokenCipher, expiresAt },
  ) => {
    const server = await ctx.db.get(serverId);
    if (server?.oauth) {
      await ctx.db.patch(serverId, {
        oauth: {
          ...server.oauth,
          accessTokenCipher,
          refreshTokenCipher,
          expiresAt,
          connected: true,
        },
        lastConnectedAt: Date.now(),
        lastError: undefined,
        // A fresh grant is exactly what the "sign-in expired" banner was
        // asking for; retire it in the same write.
        authExpiredAt: undefined,
        updatedAt: Date.now(),
      });
    }
    const flow = await ctx.db.get(flowId);
    if (flow) await ctx.db.delete(flowId);
    return null;
  },
});

/** Replace just the tokens after a silent refresh (from the stream/test path). */
export const updateOAuthTokens = internalMutation({
  args: {
    serverId: v.id("mcpServers"),
    accessTokenCipher: v.string(),
    refreshTokenCipher: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { serverId, accessTokenCipher, refreshTokenCipher, expiresAt },
  ) => {
    const server = await ctx.db.get(serverId);
    if (!server?.oauth) return null;
    await ctx.db.patch(serverId, {
      oauth: {
        ...server.oauth,
        accessTokenCipher,
        refreshTokenCipher: refreshTokenCipher ?? server.oauth.refreshTokenCipher,
        expiresAt,
        connected: true,
      },
      // A silent refresh that worked means the grant is healthy again.
      authExpiredAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Kick off the OAuth flow for a server: discover its authorization server,
 * register a client via DCR, and return the consent URL for the client to open.
 * Paid-only. The browser opens the URL; the provider redirects to the callback.
 */
export const startOAuth = action({
  args: { id: v.id("mcpServers") },
  handler: async (ctx, { id }): Promise<{ authorizationUrl: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const customerId = identity.subject;

    const autumnSecretKey = process.env.AUTUMN_SECRET_KEY;
    if (autumnSecretKey) {
      const autumn = new Autumn({ secretKey: autumnSecretKey });
      if (!(await isPaidCustomer({ autumn, customerId }))) {
        throw new Error("MCP servers are a paid feature.");
      }
    }

    const server = await ctx.runQuery(internal.mcpServers.getServerInternal, {
      id,
    });
    if (!server || server.userId !== customerId) {
      throw new Error("Server not found");
    }

    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) throw new Error("CONVEX_SITE_URL is not configured.");
    const redirectUri = `${siteUrl}/mcp/oauth/callback`;

    const { meta, client } = await discoverAndRegister({
      mcpUrl: server.url,
      redirectUri,
    });
    // Ask for what registration actually granted, not what discovery advertised.
    const scope = client.scope;

    const codeVerifier = randomToken(48);
    const codeChallenge = await codeChallengeS256(codeVerifier);
    const state = randomToken(32);
    const clientSecretCipher = client.clientSecret
      ? await encryptSecret(client.clientSecret)
      : undefined;

    await ctx.runMutation(internal.mcpOAuthFlow.beginOAuthFlow, {
      serverId: id,
      state,
      codeVerifier,
      redirectUri,
      clientId: client.clientId,
      clientSecretCipher,
      authorizationEndpoint: meta.authorizationEndpoint,
      tokenEndpoint: meta.tokenEndpoint,
      registrationEndpoint: meta.registrationEndpoint,
      scope,
      resource: meta.resource,
    });

    return {
      authorizationUrl: buildAuthorizationUrl({
        authorizationEndpoint: meta.authorizationEndpoint,
        clientId: client.clientId,
        redirectUri,
        scope,
        state,
        codeChallenge,
        resource: meta.resource,
      }),
    };
  },
});

/** Drop the stored grant so the server is "disconnected" (keeps the client). */
export const disconnectOAuth = mutation({
  args: { id: v.id("mcpServers") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const server = await ctx.db.get(id);
    if (!server || server.userId !== identity.subject) {
      throw new Error("Server not found");
    }
    if (server.oauth) {
      await ctx.db.patch(id, {
        oauth: {
          ...server.oauth,
          accessTokenCipher: undefined,
          refreshTokenCipher: undefined,
          expiresAt: undefined,
          connected: false,
        },
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Escape text for safe interpolation into HTML markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shared by the MCP OAuth callback below and the Composio connect callback
 * (integrationStore.composioOAuthCallback) — both popups speak the same
 * `mcp-oauth` postMessage dialect to the app. */
export function callbackHtml(payload: {
  ok: boolean;
  error?: string;
  name?: string;
}) {
  // payload carries provider/user-controlled strings (server name,
  // error_description). Serialize for the inline <script> so the data can't
  // terminate the tag (`</script>`) or break the line, then HTML-escape every
  // value we drop into markup.
  const message = JSON.stringify({ type: "mcp-oauth", ...payload }).replace(
    /[<\u2028\u2029]/g,
    (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  const heading = escapeHtml(
    payload.ok
      ? `Connected${payload.name ? ` to ${payload.name}` : ""}!`
      : "Couldn't connect",
  );
  const detail = escapeHtml(
    payload.ok
      ? "You can close this window and head back to Whirl."
      : (payload.error ?? "Something went wrong."),
  );
  // When opened in a popup, post the result to the opener and close. When the
  // popup was blocked and this is a full-tab redirect (no opener), send the user
  // back to the settings page.
  const returnUrl = JSON.stringify(
    `${siteUrl()}/settings?section=mcp-servers`,
  );
  const delay = payload.ok ? 500 : 2500;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${heading}</title><style>body{font-family:ui-sans-serif,system-ui,sans-serif;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;background:#0b0b0b;color:#eee}main{text-align:center;max-width:24rem;padding:2rem}h1{font-size:1.1rem;margin:0 0 .5rem}p{font-size:.9rem;color:#aaa;margin:0}</style></head><body><main><h1>${heading}</h1><p>${detail}</p></main><script>(function(){var url=${returnUrl};try{if(window.opener){window.opener.postMessage(${message},"*");setTimeout(function(){window.close();},${delay});return;}}catch(e){}if(url){setTimeout(function(){window.location.href=url;},${delay});}})();</script></body></html>`;
}

/**
 * OAuth redirect target. The provider sends the user here with `?code&state`;
 * we exchange the code for tokens, store them encrypted, and return a small
 * page that tells the opener and closes itself. Not Clerk-authenticated — the
 * unguessable `state` binds the callback to the user/server that started it.
 */
export const mcpOAuthCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const fail = (error: string) =>
    new Response(callbackHtml({ ok: false, error }), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

  if (errorParam) {
    return fail(url.searchParams.get("error_description") || errorParam);
  }
  if (!code || !state) return fail("Missing authorization code.");

  const found = await ctx.runQuery(internal.mcpOAuthFlow.getFlowAndServer, {
    state,
  });
  if (!found) {
    return fail("This sign-in link has expired. Try connecting again.");
  }
  const { flow, server } = found;
  if (!server.oauth) return fail("Server is not set up for OAuth.");

  try {
    const clientSecret = server.oauth.clientSecretCipher
      ? await decryptSecret(server.oauth.clientSecretCipher)
      : undefined;
    const tokens = await exchangeCode({
      tokenEndpoint: server.oauth.tokenEndpoint,
      clientId: server.oauth.clientId,
      clientSecret,
      code,
      codeVerifier: flow.codeVerifier,
      redirectUri: flow.redirectUri,
      resource: server.oauth.resource,
    });
    const accessTokenCipher = await encryptSecret(tokens.accessToken);
    const refreshTokenCipher = tokens.refreshToken
      ? await encryptSecret(tokens.refreshToken)
      : undefined;
    await ctx.runMutation(internal.mcpOAuthFlow.completeOAuth, {
      flowId: flow._id,
      serverId: server._id,
      accessTokenCipher,
      refreshTokenCipher,
      expiresAt: tokens.expiresAt,
    });
    return new Response(callbackHtml({ ok: true, name: server.name }), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Token exchange failed.");
  }
});
