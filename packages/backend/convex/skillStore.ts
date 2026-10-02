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
  type QueryCtx,
} from "./_generated/server";
import { findRuntimeCustomSkill } from "./customSkills";
import { isPaidCustomer } from "./inference/billing";

// The user-facing side of the store's Skills tab: browsing approved skills,
// installing one, and managing the installs. Registration and review live in
// convex/skills.ts (the console backend); this file is what the Whirl app's
// /integrations page talks to.
//
// An install is a `skillInstalls` row pointing back at the listing. Unlike
// integrations there is no server, no auth flow, and no quota — a skill is
// just text the model pulls in on demand (see convex/inference/skills.ts).

const MAX_STORE_ENTRIES = 200;
// Installs are uncapped, so list queries need their own explicit bound.
const MAX_LISTED_INSTALLS = 500;

/** Rows written before the approval workflow existed count as approved. */
function isApproved(row: Doc<"skills">): boolean {
  return (row.status ?? "approved") === "approved";
}

/** Listable = approved by an admin and switched on by its developer. */
function isListable(row: Doc<"skills">): boolean {
  return isApproved(row) && row.enabled;
}

/** The store-shopper's view of a listing: branding only, never the text. */
async function toStoreEntry(ctx: QueryCtx, row: Doc<"skills">) {
  return {
    id: row._id,
    name: row.name,
    description: row.description,
    author: row.author,
    // The shelf the browse page groups this listing under; null until the
    // classifier has been by (clients bucket that as "Everything else").
    category: row.category ?? null,
    verified: row.verified === true,
    logoUrl: row.logoId ? await ctx.storage.getUrl(row.logoId) : null,
    bannerUrl: row.bannerId ? await ctx.storage.getUrl(row.bannerId) : null,
    iconSvg: row.iconSvg,
  };
}

/** The signed-in user's install rows, keyed by store listing. */
async function installsBySkill(ctx: QueryCtx, userId: string) {
  const installs = await ctx.db
    .query("skillInstalls")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(MAX_LISTED_INSTALLS);
  const map = new Map<Id<"skills">, Doc<"skillInstalls">>();
  for (const install of installs) {
    map.set(install.skillId, install);
  }
  return map;
}

/**
 * The storefront: every approved + enabled skill, alphabetical, plus (when
 * signed in) whether the caller already has it installed.
 */
export const listStore = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("skills")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .take(MAX_STORE_ENTRIES);
    const listable = rows.filter(isListable);
    listable.sort((a, b) => a.name.localeCompare(b.name));

    const identity = await ctx.auth.getUserIdentity();
    const installed = identity
      ? await installsBySkill(ctx, identity.subject)
      : new Map<Id<"skills">, Doc<"skillInstalls">>();

    return Promise.all(
      listable.map(async (row) => ({
        ...(await toStoreEntry(ctx, row)),
        installed: installed.has(row._id),
      })),
    );
  },
});

/**
 * The caller's installed skills for the manage tab: the install row
 * (enable/disable) joined with the listing's branding. A listing that was
 * deleted or unlisted after install still shows, just with whatever branding
 * survives — though a delisted skill won't load in chat anymore.
 */
export const listInstalled = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const installs = await ctx.db
      .query("skillInstalls")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .take(MAX_LISTED_INSTALLS);
    installs.sort((a, b) => b.createdAt - a.createdAt);
    return Promise.all(
      installs.map(async (install) => {
        const listing = await ctx.db.get(install.skillId);
        return {
          installId: install._id,
          name: listing?.name ?? "Removed skill",
          description: listing?.description,
          author: listing?.author,
          verified: listing?.verified === true,
          logoUrl: listing?.logoId
            ? await ctx.storage.getUrl(listing.logoId)
            : null,
          iconSvg: listing?.iconSvg,
          enabled: install.enabled,
          installedAt: install.createdAt,
        };
      }),
    );
  },
});

/**
 * Install a skill from the store. An action so it can ask Autumn about the
 * caller's plan — skills are paid-only like integrations, enforced here (and
 * again at runtime in the stream), with the client's upgrade modal as mere UX
 * on top. No quota: install as many as you like. The write itself happens in
 * `installInternal` below.
 */
export const install = action({
  args: { id: v.id("skills") },
  handler: async (ctx, args): Promise<{ installId: Id<"skillInstalls"> }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    // Same gate as integrationStore.install: skip only when Autumn isn't
    // configured (local dev without billing).
    const autumnSecretKey = process.env.AUTUMN_SECRET_KEY;
    if (autumnSecretKey) {
      const autumn = new Autumn({ secretKey: autumnSecretKey });
      const paid = await isPaidCustomer({
        autumn,
        customerId: identity.subject,
      });
      if (!paid) throw new Error("Skills are a paid feature.");
    }

    return ctx.runMutation(internal.skillStore.installInternal, args);
  },
});

/** The install write, called from the paid-gated `install` action above. */
export const installInternal = internalMutation({
  args: { id: v.id("skills") },
  handler: async (ctx, args): Promise<{ installId: Id<"skillInstalls"> }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject;

    const row = await ctx.db.get(args.id);
    if (!row || !isListable(row)) {
      throw new Error("That skill isn't available right now.");
    }

    const installed = await installsBySkill(ctx, userId);
    if (installed.has(args.id)) {
      throw new Error("You already have this skill installed.");
    }

    const now = Date.now();
    const installId = await ctx.db.insert("skillInstalls", {
      userId,
      skillId: args.id,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    return { installId };
  },
});

/** Flip an installed skill on or off. */
export const setInstallEnabled = mutation({
  args: {
    installId: v.id("skillInstalls"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const install = await ctx.db.get(args.installId);
    if (!install || install.userId !== identity.subject) {
      throw new Error("Skill not found");
    }
    await ctx.db.patch(args.installId, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Uninstall a skill. The listing itself is untouched. */
export const uninstall = mutation({
  args: { installId: v.id("skillInstalls") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const install = await ctx.db.get(args.installId);
    if (!install || install.userId !== identity.subject) {
      throw new Error("Skill not found");
    }
    await ctx.db.delete(args.installId);
    return null;
  },
});

/**
 * The user's enabled skills for a chat turn: name + description (plus the
 * install/listing ids so callers can flag @mentioned ones), for the system
 * prompt's "Installed skills" list. The text stays out — the model pulls it
 * on demand via load_skill, and getRequestForStream inlines it only for
 * mentioned skills. A plain helper (not a Convex function) so
 * getRequestForStream can fold it into its single query.
 */
type RuntimeSkill = {
  installId: Id<"skillInstalls">;
  skillId: Id<"skills">;
  name: string;
  description: string | undefined;
};

export async function listRuntimeSkills(
  ctx: QueryCtx,
  userId: string,
): Promise<RuntimeSkill[]> {
  const installs = await ctx.db
    .query("skillInstalls")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(MAX_LISTED_INSTALLS);
  const skills = (
    await Promise.all(
      installs
        .filter((install) => install.enabled)
        .map(async (install) => {
          const listing = await ctx.db.get(install.skillId);
          if (!listing || !isListable(listing)) return null;
          return {
            installId: install._id,
            skillId: install.skillId,
            name: listing.name,
            description: listing.description,
          };
        }),
    )
  ).filter((skill): skill is RuntimeSkill => skill !== null);
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

/**
 * Fetch one skill's instruction text for the load_skill tool. Verifies the
 * user actually has an enabled install of a still-listed skill matching the
 * name (case-insensitive) — the model can't load skills the user doesn't
 * have. Internal — the stream action passes the userId it authenticated.
 */
export const loadSkillText = internalQuery({
  args: { userId: v.string(), name: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ name: string; instructions: string } | null> => {
    const wanted = args.name.trim().toLowerCase();
    if (!wanted) return null;
    const installs = await ctx.db
      .query("skillInstalls")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(MAX_LISTED_INSTALLS);
    for (const install of installs) {
      if (!install.enabled) continue;
      const listing = await ctx.db.get(install.skillId);
      if (!listing || !isListable(listing)) continue;
      if (listing.name.trim().toLowerCase() !== wanted) continue;
      return { name: listing.name, instructions: listing.instructions };
    }
    // No store install by that name — maybe it's one of the user's own
    // (checked second, so a name clash resolves to the store skill).
    return await findRuntimeCustomSkill(ctx, args.userId, args.name);
  },
});
