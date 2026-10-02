import { v } from "convex/values";

import { mutation } from "./_generated/server";

const unitsSystemValidator = v.union(
  v.literal("auto"),
  v.literal("metric"),
  v.literal("imperial"),
);

/** Clamp a free-form client coordinate into the valid earthly range. */
function clampCoord(value: number, max: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.max(-max, Math.min(max, value));
}

/**
 * Upserts the signed-in user's device context (IANA timezone + locale).
 * Reported automatically by the client; skips the write when nothing changed.
 */
export const report = mutation({
  args: {
    timeZone: v.string(),
    locale: v.optional(v.string()),
    unitsSystem: v.optional(unitsSystemValidator),
  },
  handler: async (ctx, { timeZone, locale, unitsSystem }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    // Sanity-cap free-form client strings.
    const tz = timeZone.slice(0, 64);
    const loc = locale?.slice(0, 32);

    const existing = await ctx.db
      .query("userContext")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .unique();

    if (existing) {
      if (
        existing.timeZone === tz &&
        existing.locale === loc &&
        existing.unitsSystem === unitsSystem
      ) {
        return null;
      }
      await ctx.db.patch(existing._id, {
        timeZone: tz,
        locale: loc,
        ...(unitsSystem !== undefined ? { unitsSystem } : {}),
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("userContext", {
        userId: identity.subject,
        timeZone: tz,
        locale: loc,
        ...(unitsSystem !== undefined ? { unitsSystem } : {}),
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Persists the user's metric/imperial preference for server-side weather fetches. */
export const setUnitsSystem = mutation({
  args: { unitsSystem: unitsSystemValidator },
  handler: async (ctx, { unitsSystem }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const existing = await ctx.db
      .query("userContext")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .unique();

    if (existing) {
      if (existing.unitsSystem === unitsSystem) return null;
      await ctx.db.patch(existing._id, {
        unitsSystem,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("userContext", {
        userId: identity.subject,
        timeZone: "UTC",
        unitsSystem,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/**
 * Records the user's precise coordinates from the browser Geolocation API.
 * Only ever called when permission is already granted (read silently on load)
 * or after the user explicitly opts in via the weather widget — we never force
 * a permission prompt ourselves. The `place` label is filled in later by the
 * weather tool's reverse lookup; we just stash the raw coordinates here.
 */
export const reportPreciseLocation = mutation({
  args: {
    latitude: v.number(),
    longitude: v.number(),
  },
  handler: async (ctx, { latitude, longitude }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const lat = clampCoord(latitude, 90);
    const lng = clampCoord(longitude, 180);
    if (lat === undefined || lng === undefined) return null;

    const existing = await ctx.db
      .query("userContext")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .unique();

    if (existing) {
      // Don't churn the row for sub-kilometre jitter (~0.01° ≈ 1.1km).
      if (
        existing.latitude !== undefined &&
        existing.longitude !== undefined &&
        Math.abs(existing.latitude - lat) < 0.01 &&
        Math.abs(existing.longitude - lng) < 0.01
      ) {
        return null;
      }
      await ctx.db.patch(existing._id, {
        latitude: lat,
        longitude: lng,
        // Coordinates moved, so any previously resolved place name is stale.
        place: undefined,
        locationUpdatedAt: Date.now(),
        updatedAt: Date.now(),
      });
    } else {
      // No context row yet (timezone not reported) — seed one with whatever the
      // client knows so the coordinates aren't lost.
      await ctx.db.insert("userContext", {
        userId: identity.subject,
        timeZone: "UTC",
        latitude: lat,
        longitude: lng,
        locationUpdatedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
