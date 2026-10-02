import { v } from "convex/values";

import { internal } from "./_generated/api";
import { httpAction, internalMutation, query } from "./_generated/server";
import { siteUrl } from "./site";

/**
 * The version (git SHA) of the currently live production deployment. Clients
 * subscribe to this; when it differs from the version they were built with,
 * a newer client has shipped and they're prompted to refresh. Returns null
 * until the first deploy webhook has populated the singleton.
 */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db.query("deployment").first();
    return doc ? { version: doc.version, updatedAt: doc.updatedAt } : null;
  },
});

/**
 * Upserts the deployment singleton with the latest production version. Internal
 * — only the deploy webhook handler below calls this.
 */
export const setVersion = internalMutation({
  args: { version: v.string(), updatedAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("deployment").first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        version: args.version,
        updatedAt: args.updatedAt,
      });
    } else {
      await ctx.db.insert("deployment", {
        version: args.version,
        updatedAt: args.updatedAt,
      });
    }
    return null;
  },
});

// Constant-time comparison so signature checks don't leak via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// Vercel signs webhook payloads with HMAC-SHA1 (hex) over the raw body, in the
// `x-vercel-signature` header. Verify it with Web Crypto (no Node runtime).
async function verifySignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  const expected = Array.from(new Uint8Array(mac))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(expected, signature);
}

// The support agent's tool route, re-read after every production deploy.
//
// Median holds its own copy of what apps/v2/median.config.ts declares, and a
// GET on that route carrying `Authorization: Bearer $MEDIAN_KEY` is what
// refreshes it (a bare GET is a 401 since agent-tools 0.3). Without this, a
// tool renamed or retired in a release keeps being offered to customers until
// somebody remembers to curl it by hand. MEDIAN_KEY is the same value Vercel
// has: `npx convex env set MEDIAN_KEY median_key_...`. The support agent is
// optional, so a deployment without the key skips this quietly.
//
// Best effort on purpose: a Median outage must not fail the webhook, because
// the same request is what tells every open tab that a new version shipped.
async function resyncMedianTools(): Promise<void> {
  const key = process.env.MEDIAN_KEY;
  if (!key) return;
  const site = siteUrl();
  try {
    const response = await fetch(`${site}/api/median`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(
        `median_tools_resync_failed status=${response.status} ${detail}`.trim(),
      );
    }
  } catch (error) {
    console.error("median_tools_resync_failed", error);
  }
}

/**
 * Receives Vercel deployment webhooks. On a successful production deployment it
 * records the new git SHA, which Convex then pushes to every connected client
 * over their existing WebSocket. Mounted at `/api/deploy-hook` in http.ts.
 */
export const vercelDeployHook = httpAction(async (ctx, req) => {
  const secret = process.env.VERCEL_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const raw = await req.text();
  const signature = req.headers.get("x-vercel-signature");
  const valid = signature
    ? await verifySignature(raw, signature, secret)
    : false;
  if (!valid) {
    return new Response("Invalid signature", { status: 401 });
  }

  let event: {
    payload?: {
      target?: string;
      deployment?: {
        target?: string;
        meta?: Record<string, string | undefined>;
      };
    };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const payload = event.payload ?? {};
  const target = payload.target ?? payload.deployment?.target;
  const meta = payload.deployment?.meta ?? {};
  const sha =
    meta.githubCommitSha ?? meta.gitlabCommitSha ?? meta.bitbucketCommitSha;

  // Only react to production deployments; ignore previews and other events.
  if (target === "production" && typeof sha === "string" && sha.length > 0) {
    await ctx.runMutation(internal.deployment.setVersion, {
      version: sha,
      updatedAt: Date.now(),
    });
    await resyncMedianTools();
  }

  // Always 200 so Vercel doesn't retry events we intentionally ignore.
  return new Response("ok", { status: 200 });
});
