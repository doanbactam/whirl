import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

// Bring-your-own skills, written by hand in Settings → Integrations. A custom
// skill is the same thing a store skill is at runtime — a named block of
// instructions the model pulls in via load_skill — minus the listing: no
// approval queue, no branding, instructions right on the row. Store skills
// live in convex/skillStore.ts; the runtime merges both kinds (see
// listRuntimeCustomSkills below and skillStore.loadSkillText).

const MAX_CUSTOM_SKILLS_PER_USER = 20;
const MAX_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_INSTRUCTIONS_LENGTH = 100_000;

function normalizeName(raw: string): string {
  const name = raw.trim().slice(0, MAX_NAME_LENGTH);
  if (!name) throw new Error("Give the skill a name.");
  return name;
}

function normalizeDescription(raw: string | undefined): string | undefined {
  const description = raw?.trim().slice(0, MAX_DESCRIPTION_LENGTH);
  return description || undefined;
}

function normalizeInstructions(raw: string): string {
  const instructions = raw.trim();
  if (!instructions) throw new Error("Write the skill's instructions first.");
  if (instructions.length > MAX_INSTRUCTIONS_LENGTH) {
    throw new Error(
      `The skill text is too long — keep it under ${MAX_INSTRUCTIONS_LENGTH.toLocaleString("en-US")} characters.`,
    );
  }
  return instructions;
}

async function requireUserId(ctx: {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not authenticated");
  return identity.subject;
}

async function requireOwnedSkill(
  ctx: MutationCtx,
  userId: string,
  id: Id<"customSkills">,
): Promise<Doc<"customSkills">> {
  const row = await ctx.db.get(id);
  if (!row || row.userId !== userId) throw new Error("Skill not found");
  return row;
}

/** What the client sees — the whole row is the user's own, so nothing is
 *  held back. */
function toView(row: Doc<"customSkills">) {
  return {
    id: row._id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    enabled: row.enabled,
    updatedAt: row.updatedAt,
  };
}

/** The signed-in user's custom skills, newest first. */
export const listSkills = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("customSkills")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .take(MAX_CUSTOM_SKILLS_PER_USER);
    return rows.sort((a, b) => b.createdAt - a.createdAt).map(toView);
  },
});

/** Add a custom skill. */
export const addSkill = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    instructions: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"customSkills">> => {
    const userId = await requireUserId(ctx);

    const existing = await ctx.db
      .query("customSkills")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(MAX_CUSTOM_SKILLS_PER_USER);
    if (existing.length >= MAX_CUSTOM_SKILLS_PER_USER) {
      throw new Error(
        `You can have up to ${MAX_CUSTOM_SKILLS_PER_USER} custom skills. Remove one first.`,
      );
    }

    const now = Date.now();
    return await ctx.db.insert("customSkills", {
      userId,
      name: normalizeName(args.name),
      description: normalizeDescription(args.description),
      instructions: normalizeInstructions(args.instructions),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Edit a custom skill's name, description, or instructions. */
export const updateSkill = mutation({
  args: {
    id: v.id("customSkills"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    instructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedSkill(ctx, userId, args.id);
    await ctx.db.patch(args.id, {
      ...(args.name !== undefined ? { name: normalizeName(args.name) } : {}),
      ...(args.description !== undefined
        ? { description: normalizeDescription(args.description) }
        : {}),
      ...(args.instructions !== undefined
        ? { instructions: normalizeInstructions(args.instructions) }
        : {}),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Flip a custom skill on or off without deleting it. */
export const setSkillEnabled = mutation({
  args: { id: v.id("customSkills"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedSkill(ctx, userId, args.id);
    await ctx.db.patch(args.id, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Delete a custom skill. */
export const removeSkill = mutation({
  args: { id: v.id("customSkills") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedSkill(ctx, userId, args.id);
    await ctx.db.delete(args.id);
    return null;
  },
});

/**
 * The user's enabled custom skills for a chat turn — the bring-your-own half
 * of the prompt's "Installed skills" list. A plain helper (not a Convex
 * function) so inference.ts can fold it into its single query, mirroring
 * skillStore.listRuntimeSkills.
 */
export async function listRuntimeCustomSkills(
  ctx: QueryCtx,
  userId: string,
): Promise<{ name: string; description?: string }[]> {
  const rows = await ctx.db
    .query("customSkills")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(MAX_CUSTOM_SKILLS_PER_USER);
  return rows
    .filter((row) => row.enabled)
    .map((row) => ({ name: row.name, description: row.description }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve a custom skill's instruction text by name for the load_skill tool —
 * checked by skillStore.loadSkillText after store installs, so a store skill
 * and a custom skill sharing a name resolves to the store one.
 */
export async function findRuntimeCustomSkill(
  ctx: QueryCtx,
  userId: string,
  name: string,
): Promise<{ name: string; instructions: string } | null> {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const rows = await ctx.db
    .query("customSkills")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(MAX_CUSTOM_SKILLS_PER_USER);
  for (const row of rows) {
    if (!row.enabled || row.name.trim().toLowerCase() !== wanted) continue;
    return { name: row.name, instructions: row.instructions };
  }
  return null;
}
