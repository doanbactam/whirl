import { ConvexError, v } from "convex/values";

import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import {
  applyFindReplaceEdits,
  findReplaceEditValidator,
} from "./inference/textMatch";
import {
  createHtmlBody,
  readHtmlBody,
  setHtmlBody,
} from "./artifactContent";
import { artifactBindingValidator } from "./validators";

const MAX_TITLE_LENGTH = 120;

// 12 chars over a 31-symbol alphabet ≈ 59 bits — these are unauthenticated
// public tokens (the only gate on /visual/{shortId}), so the space must be far
// too large to brute-force or scrape. Keep in sync with threads' SHARE_ID_LENGTH.
const SHORT_ID_LENGTH = 12;
// Unambiguous alphabet (no 0/O/1/l/I) so share tokens are easy to read/type.
const SHORT_ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

function randomToken(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = "";
  for (let i = 0; i < length; i += 1) {
    id += SHORT_ID_ALPHABET[bytes[i] % SHORT_ID_ALPHABET.length];
  }
  return id;
}

/** A public share token not already taken (widens on the rare clash). */
async function uniqueShortId(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = randomToken(SHORT_ID_LENGTH);
    const existing = await ctx.db
      .query("htmlArtifacts")
      .withIndex("by_short_id", (q) => q.eq("shortId", id))
      .first();
    if (!existing) return id;
  }
  return randomToken(SHORT_ID_LENGTH + 3);
}

/**
 * The live row behind an inline HTML card or the full-HTML side panel.
 * Auth-scoped: a user only ever reads their own artifacts. Returns null when
 * it's gone (e.g. the thread was deleted) so the card/panel settles gracefully.
 */
export const getHtmlArtifact = query({
  args: { htmlId: v.id("htmlArtifacts") },
  handler: async (ctx, { htmlId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const row = await ctx.db.get(htmlId);
    if (!row || row.userId !== identity.subject) return null;
    // The body lives in its own row now; the card/panel still wants one object.
    return { ...row, content: await readHtmlBody(ctx, row) };
  },
});

/**
 * Public read for a shared artifact by its short token — powers
 * {site}/visual/{shortId}. Deliberately UNAUTHENTICATED: the token is the gate,
 * so anyone with the link can view it. Returns only what the share page needs
 * (title/content/kind), and only for a completed artifact, so in-progress,
 * failed, or empty ones are never exposed.
 *
 * An artifact that reads live integration data is never served here. Its
 * bindings only mean anything when run as the owner, and running them for a
 * stranger — or serving a body whose whole point is the owner's data — is not
 * something a share link should be able to ask for. The page gets an explicit
 * locked answer instead of a 404 so it can say why.
 */
export const getSharedArtifact = query({
  args: { shortId: v.string() },
  handler: async (ctx, { shortId }) => {
    const row = await ctx.db
      .query("htmlArtifacts")
      .withIndex("by_short_id", (q) => q.eq("shortId", shortId))
      .first();
    if (!row || row.status !== "complete") return null;
    if ((row.bindings?.length ?? 0) > 0) {
      return { dataLocked: true as const };
    }
    const content = await readHtmlBody(ctx, row);
    if (!content) return null;
    return {
      title: row.title,
      content,
      kind: row.kind,
      runtime: row.runtime ?? ("html" as const),
    };
  },
});

/**
 * Open a brand-new HTML artifact (inline viz or full page) for whirl to stream
 * into. Inserted empty and "streaming" on tool-input-start, before a token of
 * the body arrives, so the card/panel can latch onto the live row and watch it
 * fill in. {@link finalizeStreamingHtml} closes it out.
 */
export const createStreamingHtml = internalMutation({
  args: {
    threadId: v.id("threads"),
    userId: v.string(),
    kind: v.union(v.literal("inline"), v.literal("full")),
    runtime: v.optional(v.union(v.literal("html"), v.literal("react"))),
    createdByMessageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const htmlId = await ctx.db.insert("htmlArtifacts", {
      threadId: args.threadId,
      userId: args.userId,
      kind: args.kind,
      ...(args.runtime ? { runtime: args.runtime } : {}),
      title: "",
      contentId: await createHtmlBody(ctx, ""),
      hasContent: false,
      status: "streaming",
      shortId: await uniqueShortId(ctx),
      ...(args.createdByMessageId
        ? { createdByMessageId: args.createdByMessageId }
        : {}),
      updatedAt: Date.now(),
    });
    return { htmlId };
  },
});

/**
 * Patch the partial title/content of an artifact while the main agent is still
 * writing it. Throttled by the caller; a no-op once the row is gone, and it
 * never touches `status`. ("generating" is a legacy status from the retired
 * background page builder — tolerated so an in-flight row at deploy settles.)
 */
export const patchHtmlContent = internalMutation({
  args: {
    htmlId: v.id("htmlArtifacts"),
    content: v.string(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { htmlId, content, title }) => {
    const row = await ctx.db.get(htmlId);
    if (!row) return;
    if (row.status !== "streaming" && row.status !== "generating") return;

    await setHtmlBody(ctx, row, content);

    /* Title only when it actually moved — see the note in documents.ts's
       patchStreamingContent. Every write to this row re-runs the thread's
       artifact listing, so a streaming body must not touch it. */
    if (title !== undefined && title !== row.title) {
      await ctx.db.patch(htmlId, { title });
    }
  },
});

/**
 * Close out a streaming artifact with its final body once the tool call
 * completes. Also used (after createStreamingHtml) for the rare provider
 * that delivers the whole tool input in one shot with no streaming deltas.
 */
export const finalizeStreamingHtml = internalMutation({
  args: {
    htmlId: v.id("htmlArtifacts"),
    title: v.string(),
    content: v.string(),
    // React artifacts declare their data bindings in the same tool call that
    // writes the body, so they land here rather than at row creation.
    bindings: v.optional(v.array(artifactBindingValidator)),
    // Likewise for inline-vs-panel: a react artifact's mode arrives inside the
    // tool input, so the row is opened before it's known. The stream promotes
    // the row as soon as the field closes; this is the backstop for when it
    // closes too late for that (or never streams at all).
    kind: v.optional(v.union(v.literal("inline"), v.literal("full"))),
  },
  handler: async (ctx, { htmlId, title, content, bindings, kind }) => {
    const row = await ctx.db.get(htmlId);
    if (!row) return;
    await setHtmlBody(ctx, row, content);
    await ctx.db.patch(htmlId, {
      title: title.slice(0, MAX_TITLE_LENGTH),
      status: "complete",
      ...(bindings ? { bindings } : {}),
      ...(kind && kind !== row.kind ? { kind } : {}),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Close out a streaming artifact that never finished — a stop, a provider
 * error, a broken tool call. Used for react artifacts, where a partial body
 * can't render at all and salvaging it would only produce a card showing a
 * syntax error. HTML artifacts keep taking the salvage path instead.
 */
export const failStreamingHtml = internalMutation({
  args: {
    htmlId: v.id("htmlArtifacts"),
    error: v.string(),
  },
  handler: async (ctx, { htmlId, error }) => {
    const row = await ctx.db.get(htmlId);
    if (!row || row.status === "complete") return;
    await ctx.db.patch(htmlId, {
      status: "failed",
      error,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Apply whirl's targeted find/replace edits to an artifact (inline or full).
 * Each `find` must match the current content exactly and appear once — the model
 * is handed the artifact's current HTML in its prompt, so it copies anchors
 * verbatim. Ambiguous/missing snippets are skipped and reported back, with the
 * current content, so the model can re-anchor on a retry.
 */
export const applyHtmlEdits = internalMutation({
  args: {
    htmlId: v.id("htmlArtifacts"),
    userId: v.string(),
    edits: v.array(findReplaceEditValidator),
  },
  handler: async (ctx, { htmlId, userId, edits }) => {
    const row = await ctx.db.get(htmlId);
    if (!row || row.userId !== userId) {
      return {
        ok: false as const,
        applied: 0,
        failed: [{ find: "", reason: "artifact not found" }],
        title: "",
        content: "",
        kind: "inline" as const,
      };
    }

    const { ok, applied, failed, content } = applyFindReplaceEdits(
      await readHtmlBody(ctx, row),
      edits,
    );

    if (applied > 0) {
      await setHtmlBody(ctx, row, content);
      await ctx.db.patch(htmlId, {
        status: "complete",
        updatedAt: Date.now(),
      });
    }

    return { ok, applied, failed, title: row.title, content, kind: row.kind };
  },
});
