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
  createDocumentBody,
  readDocumentBody,
  setDocumentBody,
} from "./artifactContent";

/** A single targeted edit: replace one exact, unique snippet with another. */
export const documentEditValidator = findReplaceEditValidator;

// 12 chars over a 31-symbol alphabet ≈ 59 bits — these are unauthenticated
// public tokens (the only gate on /doc/{shortId}), so the space must be far
// too large to brute-force or scrape. Matches the htmlArtifacts and thread
// share tokens (convex/html.ts, convex/threads.ts).
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

/** A public share token not already taken (widens on the rare clash). Also
 * used by threads.ts when branching/forking deep-copies document rows. */
export async function uniqueDocumentShortId(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = randomToken(SHORT_ID_LENGTH);
    const existing = await ctx.db
      .query("documents")
      .withIndex("by_short_id", (q) => q.eq("shortId", id))
      .first();
    if (!existing) return id;
  }
  return randomToken(SHORT_ID_LENGTH + 3);
}

/**
 * The live row behind a document card / the panel editor. Auth-scoped: a user
 * only ever reads their own documents. Returns null when it's gone (e.g. the
 * thread was deleted) so the panel can close gracefully.
 */
export const getDocument = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const doc = await ctx.db.get(documentId);
    if (!doc || doc.userId !== identity.subject) return null;
    // The body lives in its own row now; the panel still wants one object.
    return { ...doc, content: await readDocumentBody(ctx, doc) };
  },
});

/**
 * Public read for a shared document by its short token — powers
 * {site}/doc/{shortId}. Deliberately UNAUTHENTICATED: the token is the gate,
 * so anyone with the link can view it. Returns only what the share page needs
 * (title/content), and only for a completed, non-empty document, so
 * in-progress or empty ones are never exposed.
 */
export const getSharedDocument = query({
  args: { shortId: v.string() },
  handler: async (ctx, { shortId }) => {
    const doc = await ctx.db
      .query("documents")
      .withIndex("by_short_id", (q) => q.eq("shortId", shortId))
      .first();
    if (!doc || doc.status === "streaming") return null;
    const content = await readDocumentBody(ctx, doc);
    if (!content.trim()) return null;
    return {
      title: doc.title,
      content,
      format: doc.format ?? "markdown",
      ...(doc.fileName ? { fileName: doc.fileName } : {}),
      ...(doc.language ? { language: doc.language } : {}),
    };
  },
});

/**
 * Mint a share token for a document that predates them (new rows get one at
 * creation). Owner-only; a no-op returning the existing token once minted, so
 * the panel can call it blindly on open.
 */
export const ensureDocumentShareId = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const doc = await ctx.db.get(documentId);
    if (!doc || doc.userId !== identity.subject) {
      throw new Error("Document not found");
    }
    if (doc.shortId) return { shortId: doc.shortId };

    const shortId = await uniqueDocumentShortId(ctx);
    await ctx.db.patch(documentId, { shortId });
    return { shortId };
  },
});

/**
 * Persist a manual edit the user made in the document panel. These documents
 * are durable artifacts, so the user's own edits save straight to the row
 * (debounced on the client) rather than riding along on the next message.
 */
export const updateDocumentContent = mutation({
  args: { documentId: v.id("documents"), content: v.string() },
  handler: async (ctx, { documentId, content }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const doc = await ctx.db.get(documentId);
    if (!doc || doc.userId !== identity.subject) {
      throw new Error("Document not found");
    }

    await setDocumentBody(ctx, doc, content);
    await ctx.db.patch(documentId, {
      status: "complete",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Open the live document row and its pending chat card in one transaction.
 * A createDocument tool call should only ever surface one document phase.
 */
export const openStreamingDocument = internalMutation({
  args: {
    threadId: v.id("threads"),
    userId: v.string(),
    assistantId: v.id("messages"),
    format: v.union(v.literal("markdown"), v.literal("code")),
    contentOffset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const assistant = await ctx.db.get(args.assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    const documentId = await ctx.db.insert("documents", {
      threadId: args.threadId,
      userId: args.userId,
      title: "",
      contentId: await createDocumentBody(ctx, ""),
      hasContent: false,
      format: args.format,
      status: "streaming",
      shortId: await uniqueDocumentShortId(ctx),
      createdByMessageId: args.assistantId,
      updatedAt: Date.now(),
    });

    await ctx.db.patch(args.assistantId, {
      phases: [
        ...(assistant.phases ?? []),
        {
          kind: "document",
          op: "create",
          documentId,
          ...(args.contentOffset !== undefined
            ? { contentOffset: args.contentOffset }
            : {}),
          pending: true,
        },
      ],
      updatedAt: Date.now(),
    });

    return { documentId };
  },
});

/**
 * Patch the partial title/content of a still-streaming document as whirl's tool
 * input arrives. Throttled by the caller; a no-op once the row is gone.
 */
export const patchStreamingContent = internalMutation({
  args: {
    documentId: v.id("documents"),
    title: v.string(),
    content: v.string(),
    fileName: v.optional(v.string()),
    language: v.optional(v.string()),
  },
  handler: async (ctx, { documentId, title, content, fileName, language }) => {
    const doc = await ctx.db.get(documentId);
    if (!doc) return;
    if (doc.status !== "streaming") return;

    await setDocumentBody(ctx, doc, content);

    /* Only the metadata that actually moved. Any patch here re-runs every
       query that lists this thread's artifacts, and per-flush churn is
       precisely what the body split exists to stop — the title settles after
       a few deltas and then this writes nothing at all. `updatedAt` waits for
       finalize; nothing watching a half-written document sorts by it. */
    const patch: Record<string, unknown> = {};
    if (title !== doc.title) patch.title = title;
    if (fileName !== undefined && fileName !== doc.fileName) {
      patch.fileName = fileName;
    }
    if (language !== undefined && language !== doc.language) {
      patch.language = language;
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(documentId, patch);
  },
});

/**
 * Close out a streaming document with its final title + body once the tool call
 * completes. Also used (after openStreamingDocument) for the rare provider
 * that delivers the whole tool input in one shot with no streaming deltas.
 */
export const finalizeDocument = internalMutation({
  args: {
    documentId: v.id("documents"),
    title: v.string(),
    content: v.string(),
    format: v.union(v.literal("markdown"), v.literal("code")),
    fileName: v.optional(v.string()),
    language: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { documentId, title, content, format, fileName, language },
  ) => {
    const doc = await ctx.db.get(documentId);
    if (!doc) return;
    await setDocumentBody(ctx, doc, content);
    await ctx.db.patch(documentId, {
      title,
      format,
      ...(fileName !== undefined ? { fileName } : {}),
      ...(language !== undefined ? { language } : {}),
      status: "complete",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Apply whirl's targeted find/replace edits to a document. Each `find` must
 * match the current content EXACTLY and appear exactly once — no fuzzy matching,
 * because the model is handed the document's current text in its prompt, so it
 * can (and must) copy anchors verbatim. Ambiguous or missing snippets are
 * skipped and reported back, along with the document's current content, so the
 * model can re-anchor on a retry. Returns the resulting content + title.
 */
export const applyDocumentEdits = internalMutation({
  args: {
    documentId: v.id("documents"),
    userId: v.string(),
    edits: v.array(documentEditValidator),
  },
  handler: async (ctx, { documentId, userId, edits }) => {
    const doc = await ctx.db.get(documentId);
    if (!doc || doc.userId !== userId) {
      return {
        ok: false as const,
        applied: 0,
        failed: [{ find: "", reason: "document not found" }],
        title: "",
        content: "",
      };
    }

    const { ok, applied, failed, content } = applyFindReplaceEdits(
      await readDocumentBody(ctx, doc),
      edits,
    );

    if (applied > 0) {
      await setDocumentBody(ctx, doc, content);
      await ctx.db.patch(documentId, {
        status: "complete",
        updatedAt: Date.now(),
      });
    }

    return { ok, applied, failed, title: doc.title, content };
  },
});
