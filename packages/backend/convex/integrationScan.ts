import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  httpAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { decryptSecret, encryptSecret } from "./inference/crypto";
import {
  buildAuthorizationUrl,
  codeChallengeS256,
  discoverAndRegister,
  exchangeCode,
  randomToken,
} from "./inference/mcpOAuth";
import { assertSafeFetchUrl } from "./inference/urlSafety";

// Scan-scoped OAuth for the console's New Integration form. Registering an
// OAuth-protected MCP server still requires listing its tools, so the
// developer signs in once through the standard MCP flow (discovery + DCR +
// PKCE, same primitives as mcpOAuthFlow.ts). The resulting grant lives on a
// short-lived `integrationScanFlows` row — encrypted, only ever used by
// integrations.scanTools, and never attached to the integration itself.

const MAX_URL_LENGTH = 2048;
const FLOW_TTL_MS = 60 * 60 * 1000;

function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (!url) throw new Error("Give the MCP server a URL.");
  if (url.length > MAX_URL_LENGTH) throw new Error("That URL is too long.");
  assertSafeFetchUrl(url);
  return url;
}

/** Open a fresh flow, sweeping the caller's previous scan flows first. */
export const beginScanFlow = internalMutation({
  args: {
    userId: v.string(),
    url: v.string(),
    state: v.string(),
    codeVerifier: v.string(),
    redirectUri: v.string(),
    clientId: v.string(),
    clientSecretCipher: v.optional(v.string()),
    tokenEndpoint: v.string(),
    resource: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // One live scan per user: old flows (and their tokens) go away the moment
    // a new one starts, which doubles as garbage collection.
    const stale = await ctx.db
      .query("integrationScanFlows")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(50);
    await Promise.all(stale.map((row) => ctx.db.delete(row._id)));

    return await ctx.db.insert("integrationScanFlows", {
      ...args,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

/** Look up an in-flight flow by the OAuth `state` param (callback path). */
export const getFlowByState = internalQuery({
  args: { state: v.string() },
  handler: async (ctx, { state }): Promise<Doc<"integrationScanFlows"> | null> => {
    return await ctx.db
      .query("integrationScanFlows")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
  },
});

/** Full flow row for the scan action (includes the token cipher). */
export const getFlowInternal = internalQuery({
  args: { id: v.id("integrationScanFlows") },
  handler: async (ctx, { id }): Promise<Doc<"integrationScanFlows"> | null> => {
    return await ctx.db.get(id);
  },
});

/** Store the exchanged token and mark the flow ready to scan with. */
export const completeScanFlow = internalMutation({
  args: {
    flowId: v.id("integrationScanFlows"),
    accessTokenCipher: v.string(),
  },
  handler: async (ctx, { flowId, accessTokenCipher }) => {
    await ctx.db.patch(flowId, {
      status: "connected",
      accessTokenCipher,
      error: undefined,
    });
    return null;
  },
});

export const failScanFlow = internalMutation({
  args: {
    flowId: v.id("integrationScanFlows"),
    error: v.string(),
  },
  handler: async (ctx, { flowId, error }) => {
    await ctx.db.patch(flowId, { status: "failed", error });
    return null;
  },
});

/**
 * What the console subscribes to while the popup is open: just the status
 * (and the failure reason) — never the token.
 */
export const getScanFlow = query({
  args: { id: v.id("integrationScanFlows") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const flow = await ctx.db.get(id);
    if (!flow || flow.userId !== identity.subject) return null;
    return { status: flow.status, error: flow.error };
  },
});

/**
 * Kick off the sign-in for a scan: discover the server's authorization
 * server, register a client via DCR, and hand back the consent URL for the
 * console to open in a popup. The callback below finishes the job.
 */
export const startScanOAuth = action({
  args: { url: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ flowId: string; authorizationUrl: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const url = normalizeUrl(args.url);

    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) throw new Error("CONVEX_SITE_URL is not configured.");
    const redirectUri = `${siteUrl}/mcp/oauth/scan-callback`;

    const { meta, client } = await discoverAndRegister({
      mcpUrl: url,
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

    const flowId = await ctx.runMutation(
      internal.integrationScan.beginScanFlow,
      {
        userId: identity.subject,
        url,
        state,
        codeVerifier,
        redirectUri,
        clientId: client.clientId,
        clientSecretCipher,
        tokenEndpoint: meta.tokenEndpoint,
        resource: meta.resource,
      },
    );

    return {
      flowId,
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function callbackHtml(payload: { ok: boolean; error?: string }) {
  const heading = escapeHtml(payload.ok ? "Connected!" : "Couldn't connect");
  const detail = escapeHtml(
    payload.ok
      ? "Head back to the console — the scan continues there."
      : (payload.error ?? "Something went wrong."),
  );
  const delay = payload.ok ? 500 : 2500;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${heading}</title><style>body{font-family:ui-sans-serif,system-ui,sans-serif;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;background:#0b0b0b;color:#eee}main{text-align:center;max-width:24rem;padding:2rem}h1{font-size:1.1rem;margin:0 0 .5rem}p{font-size:.9rem;color:#aaa;margin:0}</style></head><body><main><h1>${heading}</h1><p>${detail}</p></main><script>setTimeout(function(){try{window.close();}catch(e){}},${delay});</script></body></html>`;
}

/**
 * OAuth redirect target for scan flows. Exchanges the code, stores the token
 * on the flow row (the console is subscribed and picks it up reactively), and
 * shows a tiny page that closes itself. Not Clerk-authenticated — the
 * unguessable `state` binds the callback to the flow that started it.
 */
export const integrationScanCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const respond = (payload: { ok: boolean; error?: string }) =>
    new Response(callbackHtml(payload), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

  if (!state) return respond({ ok: false, error: "Missing state." });

  const flow = await ctx.runQuery(internal.integrationScan.getFlowByState, {
    state,
  });
  if (!flow || Date.now() - flow.createdAt > FLOW_TTL_MS) {
    return respond({
      ok: false,
      error: "This sign-in link has expired. Try connecting again.",
    });
  }

  if (errorParam) {
    const message = url.searchParams.get("error_description") || errorParam;
    await ctx.runMutation(internal.integrationScan.failScanFlow, {
      flowId: flow._id,
      error: message,
    });
    return respond({ ok: false, error: message });
  }
  if (!code) {
    return respond({ ok: false, error: "Missing authorization code." });
  }

  try {
    const clientSecret = flow.clientSecretCipher
      ? await decryptSecret(flow.clientSecretCipher)
      : undefined;
    const tokens = await exchangeCode({
      tokenEndpoint: flow.tokenEndpoint,
      clientId: flow.clientId,
      clientSecret,
      code,
      codeVerifier: flow.codeVerifier,
      redirectUri: flow.redirectUri,
      resource: flow.resource,
    });
    await ctx.runMutation(internal.integrationScan.completeScanFlow, {
      flowId: flow._id,
      accessTokenCipher: await encryptSecret(tokens.accessToken),
    });
    return respond({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Token exchange failed.";
    await ctx.runMutation(internal.integrationScan.failScanFlow, {
      flowId: flow._id,
      error: message,
    });
    return respond({ ok: false, error: message });
  }
});
