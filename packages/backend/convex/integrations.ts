import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { isAdminIdentity, requireAdmin } from "./admin";
import { decryptSecret } from "./inference/crypto";
import { mcpListTools, type McpHeader } from "./inference/mcp";
import { assertSafeFetchUrl } from "./inference/urlSafety";

// Backend for the Whirl Console (apps/console). An integration is an MCP
// server registered for the store: branding, endpoint, auth recipe, and
// developer-written tool descriptions. Every function here is scoped to the
// signed-in developer — the console shares Whirl's Clerk instance, so
// `identity.subject` lines up with the userId used across the rest of the app.

const MAX_NAME_LENGTH = 60;
const MAX_AUTHOR_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_URL_LENGTH = 2048;
const MAX_ICON_SVG_LENGTH = 32_000;
const MAX_AUTH_FIELDS = 5;
const MAX_AUTH_INSTRUCTIONS_LENGTH = 2000;
const MAX_TOOLS = 40;
const MAX_TOOL_NAME_LENGTH = 120;
const MAX_TOOL_DESCRIPTION_LENGTH = 500;
const MAX_INTEGRATIONS_PER_USER = 50;
const MAX_REVIEW_NOTE_LENGTH = 500;
const MAX_PENDING_REQUESTS = 200;

/** Store authors whose admin-submitted integrations get the blue checkmark. */
const VERIFIED_AUTHOR = "whirl";

const authModeValidator = v.union(
  v.literal("none"),
  v.literal("oauth"),
  v.literal("apiKey"),
);

const authFieldValidator = v.object({
  key: v.string(),
  label: v.string(),
});

const toolValidator = v.object({
  name: v.string(),
  description: v.string(),
  completed: v.optional(v.string()),
});

type IntegrationStatus = "pending" | "approved" | "denied";

/** Rows written before the approval workflow existed count as approved. */
function statusOf(row: Doc<"integrations">): IntegrationStatus {
  return row.status ?? "approved";
}

/**
 * The console-safe view of an integration. Async because the logo/banner
 * live in Convex storage and are exposed as signed URLs.
 */
async function toPublicIntegration(ctx: QueryCtx, row: Doc<"integrations">) {
  return {
    id: row._id,
    name: row.name,
    description: row.description,
    author: row.author,
    verified: row.verified === true,
    logoUrl: row.logoId
      ? await ctx.storage.getUrl(row.logoId)
      : (row.logoUrl ?? null),
    bannerUrl: row.bannerId ? await ctx.storage.getUrl(row.bannerId) : null,
    iconSvg: row.iconSvg,
    mcpUrl: row.mcpUrl,
    authMode: row.authMode ?? "none",
    authFields: row.authFields ?? [],
    authInstructions: row.authInstructions,
    tools: row.tools ?? [],
    enabled: row.enabled,
    status: statusOf(row),
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** What a reviewing admin sees: the public shape plus who's asking. */
async function toAdminRequest(ctx: QueryCtx, row: Doc<"integrations">) {
  return {
    ...(await toPublicIntegration(ctx, row)),
    userId: row.userId,
    requestedByName: row.requestedByName,
    requestedByEmail: row.requestedByEmail,
  };
}

async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not authenticated");
  return identity.subject;
}

/** Load an integration and make sure the caller owns it. */
async function requireOwnedIntegration(
  ctx: MutationCtx,
  userId: string,
  id: Id<"integrations">,
) {
  const row = await ctx.db.get(id);
  if (!row || row.userId !== userId) {
    throw new Error("Integration not found");
  }
  return row;
}

function normalizeName(raw: string): string {
  const name = raw.trim().slice(0, MAX_NAME_LENGTH);
  if (!name) throw new Error("Give the integration a name.");
  return name;
}

function normalizeAuthor(raw: string): string {
  const author = raw.trim().slice(0, MAX_AUTHOR_LENGTH);
  if (!author) throw new Error("Who made this integration?");
  return author;
}

function normalizeDescription(raw: string | undefined): string | undefined {
  const description = raw?.trim().slice(0, MAX_DESCRIPTION_LENGTH);
  return description ? description : undefined;
}

function normalizeMcpUrl(raw: string): string {
  const url = raw.trim();
  if (!url) throw new Error("Give the MCP server a URL.");
  if (url.length > MAX_URL_LENGTH) throw new Error("That URL is too long.");
  // Requires https and rejects internal hosts — we fetch this server-side
  // when scanning tools, and Whirl connects to it at runtime.
  assertSafeFetchUrl(url);
  return url;
}

function normalizeIconSvg(raw: string | undefined): string | undefined {
  const svg = raw?.trim();
  if (!svg) return undefined;
  if (svg.length > MAX_ICON_SVG_LENGTH) {
    throw new Error("That icon SVG is too large — keep it under 32 KB.");
  }
  if (!svg.toLowerCase().includes("<svg")) {
    throw new Error("The icon needs to be an SVG.");
  }
  return svg;
}

function normalizeAuthConfig(args: {
  authMode: "none" | "oauth" | "apiKey";
  authFields?: { key: string; label: string }[];
  authInstructions?: string;
}) {
  if (args.authMode !== "apiKey") {
    return {
      authMode: args.authMode,
      authFields: undefined,
      authInstructions: undefined,
    };
  }
  const fields = (args.authFields ?? [])
    .map((f) => ({ key: f.key.trim(), label: f.label.trim() }))
    .filter((f) => f.key.length > 0 && f.label.length > 0)
    .slice(0, MAX_AUTH_FIELDS);
  if (fields.length === 0) {
    throw new Error("Add at least one field users fill in (e.g. an API key).");
  }
  const instructions = args.authInstructions
    ?.trim()
    .slice(0, MAX_AUTH_INSTRUCTIONS_LENGTH);
  if (!instructions) {
    throw new Error("Write instructions for how users get their key.");
  }
  return { authMode: args.authMode, authFields: fields, authInstructions: instructions };
}

function normalizeTools(
  raw: { name: string; description: string; completed?: string }[],
) {
  const tools = raw
    .map((t) => ({
      name: t.name.trim().slice(0, MAX_TOOL_NAME_LENGTH),
      description: t.description.trim().slice(0, MAX_TOOL_DESCRIPTION_LENGTH),
      completed: (t.completed ?? "")
        .trim()
        .slice(0, MAX_TOOL_DESCRIPTION_LENGTH),
    }))
    .filter((t) => t.name.length > 0)
    .slice(0, MAX_TOOLS);
  if (tools.length === 0) {
    throw new Error("Scan the server and describe at least one tool.");
  }
  for (const tool of tools) {
    if (!tool.description) {
      throw new Error(`Write a description for the "${tool.name}" tool.`);
    }
    // Both states are required going forward: the running phrase and the
    // done phrase ("Searching your issues" / "Searched your issues").
    if (!tool.completed) {
      throw new Error(
        `Write a completed state for the "${tool.name}" tool.`,
      );
    }
  }
  return tools;
}

/** All of the caller's integrations, newest first, without secrets. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("integrations")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(MAX_INTEGRATIONS_PER_USER);
    return Promise.all(rows.map((row) => toPublicIntegration(ctx, row)));
  },
});

/** One-shot upload ticket for logo/banner images (Convex storage). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Connect to an MCP server and list its tools, so the console can require a
 * description for each before submission. Optional headers let the developer
 * scan an authenticated server with their own test credentials — they're used
 * for this call only and never stored. For OAuth servers, `scanFlowId` points
 * at a connected integrationScanFlows row (see convex/integrationScan.ts) and
 * the grant rides along as a Bearer header.
 */
export const scanTools = action({
  args: {
    url: v.string(),
    headers: v.optional(
      v.array(v.object({ key: v.string(), value: v.string() })),
    ),
    scanFlowId: v.optional(v.id("integrationScanFlows")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    tools: { name: string; description?: string }[];
    error?: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    let url: string;
    try {
      url = normalizeMcpUrl(args.url);
    } catch (error) {
      return {
        ok: false,
        tools: [],
        error: error instanceof Error ? error.message : "Invalid URL",
      };
    }
    const headers: McpHeader[] = (args.headers ?? [])
      .map((h) => ({ key: h.key.trim(), value: h.value }))
      .filter((h) => h.key.length > 0 && h.value.length > 0);
    if (args.scanFlowId) {
      const flow: Doc<"integrationScanFlows"> | null = await ctx.runQuery(
        internal.integrationScan.getFlowInternal,
        { id: args.scanFlowId },
      );
      if (!flow || flow.userId !== identity.subject) {
        return {
          ok: false,
          tools: [],
          error: "That sign-in has expired — connect again.",
        };
      }
      if (flow.status !== "connected" || !flow.accessTokenCipher) {
        return {
          ok: false,
          tools: [],
          error: "Not connected yet — finish signing in first.",
        };
      }
      headers.push({
        key: "Authorization",
        value: `Bearer ${await decryptSecret(flow.accessTokenCipher)}`,
      });
    }
    try {
      const tools = await mcpListTools(url, headers);
      return {
        ok: true,
        tools: tools.slice(0, MAX_TOOLS).map((t) => ({
          name: t.name,
          description: t.description,
        })),
      };
    } catch (error) {
      return {
        ok: false,
        tools: [],
        error:
          error instanceof Error
            ? error.message
            : "Couldn't reach the MCP server.",
      };
    }
  },
});

/**
 * Register an integration for the store. Starts "pending" in the admin
 * approvals queue. `verified` (the blue checkmark) is granted only when an
 * admin account submits under the "Whirl" author name — anyone else can type
 * "Whirl", it just won't verify.
 */
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    author: v.string(),
    logoId: v.id("_storage"),
    bannerId: v.optional(v.id("_storage")),
    iconSvg: v.optional(v.string()),
    mcpUrl: v.string(),
    authMode: authModeValidator,
    authFields: v.optional(v.array(authFieldValidator)),
    authInstructions: v.optional(v.string()),
    tools: v.array(toolValidator),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject;
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(MAX_INTEGRATIONS_PER_USER);
    if (existing.length >= MAX_INTEGRATIONS_PER_USER) {
      throw new Error(
        `You can have at most ${MAX_INTEGRATIONS_PER_USER} integrations.`,
      );
    }
    const author = normalizeAuthor(args.author);
    const verified =
      author.toLowerCase() === VERIFIED_AUTHOR &&
      (await isAdminIdentity(ctx));
    const auth = normalizeAuthConfig(args);
    const now = Date.now();
    const id = await ctx.db.insert("integrations", {
      userId,
      name: normalizeName(args.name),
      description: normalizeDescription(args.description),
      author,
      verified,
      logoId: args.logoId,
      bannerId: args.bannerId,
      iconSvg: normalizeIconSvg(args.iconSvg),
      mcpUrl: normalizeMcpUrl(args.mcpUrl),
      authMode: auth.authMode,
      authFields: auth.authFields,
      authInstructions: auth.authInstructions,
      tools: normalizeTools(args.tools),
      enabled: true,
      status: "pending",
      requestedByName: identity.name,
      requestedByEmail: identity.email,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  },
});

/**
 * Full edit of an integration — everything the create form collects can
 * change. Any edit sends the row back through review: status returns to
 * "pending" and the previous decision is cleared, so nothing reaches the
 * store unreviewed. Branding files: `logoId`/`bannerId` only when replaced
 * (the old file is deleted); `clearBanner`/`clearIcon` drop the optional ones.
 */
export const update = mutation({
  args: {
    id: v.id("integrations"),
    name: v.string(),
    description: v.optional(v.string()),
    author: v.string(),
    logoId: v.optional(v.id("_storage")),
    bannerId: v.optional(v.id("_storage")),
    clearBanner: v.optional(v.boolean()),
    iconSvg: v.optional(v.string()),
    clearIcon: v.optional(v.boolean()),
    mcpUrl: v.string(),
    authMode: authModeValidator,
    authFields: v.optional(v.array(authFieldValidator)),
    authInstructions: v.optional(v.string()),
    tools: v.array(toolValidator),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const row = await requireOwnedIntegration(ctx, identity.subject, args.id);

    const author = normalizeAuthor(args.author);
    const isAdmin = await isAdminIdentity(ctx);
    const verified = author.toLowerCase() === VERIFIED_AUTHOR && isAdmin;
    const auth = normalizeAuthConfig(args);

    // Replaced branding files free their predecessors.
    let logoId = row.logoId;
    if (args.logoId && args.logoId !== row.logoId) {
      if (row.logoId) await ctx.storage.delete(row.logoId);
      logoId = args.logoId;
    }
    let bannerId = row.bannerId;
    if (args.bannerId && args.bannerId !== row.bannerId) {
      if (row.bannerId) await ctx.storage.delete(row.bannerId);
      bannerId = args.bannerId;
    } else if (args.clearBanner && row.bannerId) {
      await ctx.storage.delete(row.bannerId);
      bannerId = undefined;
    }
    const iconSvg =
      args.iconSvg !== undefined
        ? normalizeIconSvg(args.iconSvg)
        : args.clearIcon
          ? undefined
          : row.iconSvg;

    await ctx.db.patch(args.id, {
      name: normalizeName(args.name),
      description: normalizeDescription(args.description),
      author,
      verified,
      logoId,
      bannerId,
      iconSvg,
      mcpUrl: normalizeMcpUrl(args.mcpUrl),
      authMode: auth.authMode,
      authFields: auth.authFields,
      authInstructions: auth.authInstructions,
      tools: normalizeTools(args.tools),
      // Back into the queue: an edited integration is a new submission —
      // unless an admin is doing the editing. They'd only be approving
      // themselves, and it would yank live (or drafted) listings like
      // Composio extensions off the store mid-touch-up.
      ...(isAdmin
        ? {}
        : {
            status: "pending" as const,
            reviewedBy: undefined,
            reviewedAt: undefined,
            reviewNote: undefined,
          }),
      requestedByName: identity.name,
      requestedByEmail: identity.email,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Flip an integration on or off. */
export const setEnabled = mutation({
  args: {
    id: v.id("integrations"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await requireOwnedIntegration(ctx, userId, args.id);
    if (statusOf(row) !== "approved") {
      throw new Error("Only approved integrations can be toggled.");
    }
    await ctx.db.patch(args.id, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Delete an integration, its branding files, and any legacy key for good. */
export const remove = mutation({
  args: { id: v.id("integrations") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await requireOwnedIntegration(ctx, userId, args.id);
    if (row.logoId) await ctx.storage.delete(row.logoId);
    if (row.bannerId) await ctx.storage.delete(row.bannerId);
    await ctx.db.delete(args.id);
    return null;
  },
});

// --- Admin approvals (console Approvals tab) ---------------------------------

/**
 * The approvals queue: every pending request, oldest first so nobody waits
 * behind the newcomers. Returns [] for non-admins instead of throwing — the
 * sidebar badge subscribes to this before the client-side gate settles.
 */
export const listPendingRequests = query({
  args: {},
  handler: async (ctx) => {
    if (!(await isAdminIdentity(ctx))) return [];
    const rows = await ctx.db
      .query("integrations")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(MAX_PENDING_REQUESTS);
    return Promise.all(rows.map((row) => toAdminRequest(ctx, row)));
  },
});

/**
 * One request in full, for the approvals detail view. Null for non-admins and
 * for garbage ids (normalizeId keeps a mistyped URL from throwing).
 */
export const getRequest = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    if (!(await isAdminIdentity(ctx))) return null;
    const id = ctx.db.normalizeId("integrations", args.id);
    if (!id) return null;
    const row = await ctx.db.get(id);
    return row ? await toAdminRequest(ctx, row) : null;
  },
});

/**
 * Approve or deny a pending request. A denial must say why — the note is
 * shown to the requester either way.
 */
export const reviewRequest = mutation({
  args: {
    id: v.id("integrations"),
    decision: v.union(v.literal("approve"), v.literal("deny")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Integration not found");
    if (statusOf(row) !== "pending") {
      throw new Error("This request has already been reviewed.");
    }
    const note = args.note?.trim().slice(0, MAX_REVIEW_NOTE_LENGTH);
    if (args.decision === "deny" && !note) {
      throw new Error("Give a reason for the denial.");
    }
    await ctx.db.patch(args.id, {
      status: args.decision === "approve" ? "approved" : "denied",
      // The switch follows the verdict. A denied integration can never be
      // live — and since denial force-flips the switch off and only approved
      // integrations can be toggled, approval must flip it back on or a
      // once-denied integration would come back "approved" yet invisible.
      enabled: args.decision === "approve",
      reviewedBy: identity!.subject,
      reviewedAt: Date.now(),
      reviewNote: note || undefined,
      updatedAt: Date.now(),
    });
    // Freshly approved listings get shelved right away (storeCategorize.ts);
    // the cron sweep is only the safety net.
    if (args.decision === "approve") {
      await ctx.scheduler.runAfter(
        0,
        internal.storeCategorize.categorizeStore,
        {},
      );
    }
    return null;
  },
});
