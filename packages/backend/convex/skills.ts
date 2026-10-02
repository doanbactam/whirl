import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { isAdminIdentity, requireAdmin } from "./admin";

// Backend for the Whirl Console (apps/console). A skill is a pasted block of
// instructions destined for the store's Skills tab: branding plus the text
// itself, no server or auth recipe. Every function here is scoped to the
// signed-in developer — the console shares Whirl's Clerk instance, so
// `identity.subject` lines up with the userId used across the rest of the app.

const MAX_NAME_LENGTH = 60;
const MAX_AUTHOR_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_ICON_SVG_LENGTH = 32_000;
const MAX_SKILL_INSTRUCTIONS_LENGTH = 100_000;
const MAX_REVIEW_NOTE_LENGTH = 500;
const MAX_PENDING_REQUESTS = 200;
// Skills are deliberately uncapped per user (unlike integrations), so list
// queries need their own explicit bound.
const MAX_LISTED_SKILLS = 200;

/** Store authors whose admin-submitted skills get the blue checkmark. */
const VERIFIED_AUTHOR = "whirl";

type SkillStatus = "pending" | "approved" | "denied";

function statusOf(row: Doc<"skills">): SkillStatus {
  return row.status ?? "approved";
}

/**
 * The console-safe view of a skill. Async because the logo/banner live in
 * Convex storage and are exposed as signed URLs. Includes `instructions` —
 * the console is the editing surface, so the developer sees their own text.
 */
async function toPublicSkill(ctx: QueryCtx, row: Doc<"skills">) {
  return {
    id: row._id,
    name: row.name,
    description: row.description,
    author: row.author,
    verified: row.verified === true,
    logoUrl: row.logoId ? await ctx.storage.getUrl(row.logoId) : null,
    bannerUrl: row.bannerId ? await ctx.storage.getUrl(row.bannerId) : null,
    iconSvg: row.iconSvg,
    instructions: row.instructions,
    enabled: row.enabled,
    status: statusOf(row),
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** What a reviewing admin sees: the public shape plus who's asking. */
async function toAdminRequest(ctx: QueryCtx, row: Doc<"skills">) {
  return {
    ...(await toPublicSkill(ctx, row)),
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

/** Load a skill and make sure the caller owns it. */
async function requireOwnedSkill(
  ctx: MutationCtx,
  userId: string,
  id: Id<"skills">,
) {
  const row = await ctx.db.get(id);
  if (!row || row.userId !== userId) {
    throw new Error("Skill not found");
  }
  return row;
}

function normalizeName(raw: string): string {
  const name = raw.trim().slice(0, MAX_NAME_LENGTH);
  if (!name) throw new Error("Give the skill a name.");
  return name;
}

function normalizeAuthor(raw: string): string {
  const author = raw.trim().slice(0, MAX_AUTHOR_LENGTH);
  if (!author) throw new Error("Who made this skill?");
  return author;
}

function normalizeDescription(raw: string | undefined): string | undefined {
  const description = raw?.trim().slice(0, MAX_DESCRIPTION_LENGTH);
  return description ? description : undefined;
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

function normalizeInstructions(raw: string): string {
  const instructions = raw.trim();
  if (!instructions) throw new Error("Paste the skill's instructions.");
  if (instructions.length > MAX_SKILL_INSTRUCTIONS_LENGTH) {
    throw new Error(
      `The skill text is too long — keep it under ${MAX_SKILL_INSTRUCTIONS_LENGTH.toLocaleString("en-US")} characters.`,
    );
  }
  return instructions;
}

/** All of the caller's skills, newest first. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("skills")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(MAX_LISTED_SKILLS);
    return Promise.all(rows.map((row) => toPublicSkill(ctx, row)));
  },
});

/**
 * Register a skill for the store. Starts "pending" in the admin approvals
 * queue (shared with integrations). `verified` is granted only when an admin
 * account submits under the "Whirl" author name. Unlike integrations, there
 * is no cap on how many skills a developer can register.
 */
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    author: v.string(),
    logoId: v.id("_storage"),
    bannerId: v.optional(v.id("_storage")),
    iconSvg: v.optional(v.string()),
    instructions: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const author = normalizeAuthor(args.author);
    const verified =
      author.toLowerCase() === VERIFIED_AUTHOR &&
      (await isAdminIdentity(ctx));
    const now = Date.now();
    const id = await ctx.db.insert("skills", {
      userId: identity.subject,
      name: normalizeName(args.name),
      description: normalizeDescription(args.description),
      author,
      verified,
      logoId: args.logoId,
      bannerId: args.bannerId,
      iconSvg: normalizeIconSvg(args.iconSvg),
      instructions: normalizeInstructions(args.instructions),
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
 * Full edit of a skill. Any edit sends the row back through review — status
 * returns to "pending" and the previous decision is cleared — unless an admin
 * is doing the editing (they'd only be approving themselves, and it would
 * yank live listings off the store mid-touch-up). Branding files:
 * `logoId`/`bannerId` only when replaced (the old file is deleted);
 * `clearBanner`/`clearIcon` drop the optional ones.
 */
export const update = mutation({
  args: {
    id: v.id("skills"),
    name: v.string(),
    description: v.optional(v.string()),
    author: v.string(),
    logoId: v.optional(v.id("_storage")),
    bannerId: v.optional(v.id("_storage")),
    clearBanner: v.optional(v.boolean()),
    iconSvg: v.optional(v.string()),
    clearIcon: v.optional(v.boolean()),
    instructions: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const row = await requireOwnedSkill(ctx, identity.subject, args.id);

    const author = normalizeAuthor(args.author);
    const isAdmin = await isAdminIdentity(ctx);
    const verified = author.toLowerCase() === VERIFIED_AUTHOR && isAdmin;

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
      instructions: normalizeInstructions(args.instructions),
      // Back into the queue: an edited skill is a new submission — unless an
      // admin is doing the editing.
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

/** Flip a skill on or off. */
export const setEnabled = mutation({
  args: {
    id: v.id("skills"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await requireOwnedSkill(ctx, userId, args.id);
    if (statusOf(row) !== "approved") {
      throw new Error("Only approved skills can be toggled.");
    }
    await ctx.db.patch(args.id, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Delete a skill and its branding files for good. */
export const remove = mutation({
  args: { id: v.id("skills") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await requireOwnedSkill(ctx, userId, args.id);
    if (row.logoId) await ctx.storage.delete(row.logoId);
    if (row.bannerId) await ctx.storage.delete(row.bannerId);
    await ctx.db.delete(args.id);
    return null;
  },
});

// --- Admin approvals (console Approvals tab, shared queue) -------------------

/**
 * The skill half of the approvals queue: every pending request, oldest first.
 * The console merges this with integrations.listPendingRequests client-side.
 * Returns [] for non-admins instead of throwing — the sidebar badge
 * subscribes to this before the client-side gate settles.
 */
export const listPendingRequests = query({
  args: {},
  handler: async (ctx) => {
    if (!(await isAdminIdentity(ctx))) return [];
    const rows = await ctx.db
      .query("skills")
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
    const id = ctx.db.normalizeId("skills", args.id);
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
    id: v.id("skills"),
    decision: v.union(v.literal("approve"), v.literal("deny")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Skill not found");
    if (statusOf(row) !== "pending") {
      throw new Error("This request has already been reviewed.");
    }
    const note = args.note?.trim().slice(0, MAX_REVIEW_NOTE_LENGTH);
    if (args.decision === "deny" && !note) {
      throw new Error("Give a reason for the denial.");
    }
    await ctx.db.patch(args.id, {
      status: args.decision === "approve" ? "approved" : "denied",
      // The switch follows the verdict. A denied skill can never be live —
      // and since denial force-flips the switch off and only approved skills
      // can be toggled, approval must flip it back on or a once-denied skill
      // would come back "approved" yet invisible in the store.
      enabled: args.decision === "approve",
      reviewedBy: identity!.subject,
      reviewedAt: Date.now(),
      reviewNote: note || undefined,
      updatedAt: Date.now(),
    });
    // Freshly approved skills get shelved right away (storeCategorize.ts);
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
