import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Artifact bodies live in their own tables (`documentContents`,
 * `htmlArtifactContents`), reached by id from the parent's `contentId`. This
 * module is the only thing that knows that.
 *
 * Why: Convex bills a read by the document, not by the field, so while the
 * body sat inline every query that merely LISTED artifacts — the thread's
 * artifact menu, fork, branch, delete — paid for every byte of every page and
 * document in the thread. Worse, streaming a body rewrote that row hundreds of
 * times, and each rewrite invalidated those listing queries and made them read
 * it all again. Splitting the body out leaves the parent rows small and, more
 * importantly, still: a streaming body no longer touches them at all.
 *
 * Rows written before the split keep their body in `content`; every read here
 * falls back to it, and every write migrates the row on its way past. See
 * `convex/artifactBackfill.ts` for the sweep that finishes the job.
 */

type AnyCtx = QueryCtx | MutationCtx;

type ArtifactRow = {
  content?: string;
  hasContent?: boolean;
};

/** Whether an artifact has a non-empty body — without reading the body. Falls
 *  back to the legacy inline field for rows the backfill hasn't reached. */
export function hasArtifactBody(row: ArtifactRow): boolean {
  return row.hasContent ?? (row.content?.trim().length ?? 0) > 0;
}

/* --- Documents ------------------------------------------------------------- */

export async function readDocumentBody(
  ctx: AnyCtx,
  doc: Doc<"documents">,
): Promise<string> {
  if (doc.contentId) {
    const body = await ctx.db.get(doc.contentId);
    if (body) return body.content;
  }
  return doc.content ?? "";
}

/** The body row for a document about to be inserted. Written first so the
 *  parent can be created complete, in one write. */
export async function createDocumentBody(
  ctx: MutationCtx,
  content: string,
): Promise<Id<"documentContents">> {
  return await ctx.db.insert("documentContents", { content });
}

/**
 * Write a document's body. Touches the parent row ONLY when something on it
 * actually changed — which during streaming means once, not once per flush.
 * That stillness is the whole point of the split.
 */
export async function setDocumentBody(
  ctx: MutationCtx,
  doc: Doc<"documents">,
  content: string,
): Promise<void> {
  const patch: Record<string, unknown> = {};

  if (doc.contentId) {
    await ctx.db.patch(doc.contentId, { content });
  } else {
    patch.contentId = await ctx.db.insert("documentContents", { content });
    // The legacy inline copy is now stale weight — drop it.
    if (doc.content !== undefined) patch.content = undefined;
  }

  const hasContent = content.trim().length > 0;
  if (hasArtifactBody(doc) !== hasContent) patch.hasContent = hasContent;

  if (Object.keys(patch).length > 0) await ctx.db.patch(doc._id, patch);
}

/** Drop a document's body row. Call before deleting the document itself. */
export async function deleteDocumentBody(
  ctx: MutationCtx,
  doc: Doc<"documents">,
): Promise<void> {
  if (doc.contentId) await ctx.db.delete(doc.contentId);
}

/* --- HTML artifacts -------------------------------------------------------- */

export async function readHtmlBody(
  ctx: AnyCtx,
  row: Doc<"htmlArtifacts">,
): Promise<string> {
  if (row.contentId) {
    const body = await ctx.db.get(row.contentId);
    if (body) return body.content;
  }
  return row.content ?? "";
}

export async function createHtmlBody(
  ctx: MutationCtx,
  content: string,
): Promise<Id<"htmlArtifactContents">> {
  return await ctx.db.insert("htmlArtifactContents", { content });
}

export async function setHtmlBody(
  ctx: MutationCtx,
  row: Doc<"htmlArtifacts">,
  content: string,
): Promise<void> {
  const patch: Record<string, unknown> = {};

  if (row.contentId) {
    await ctx.db.patch(row.contentId, { content });
  } else {
    patch.contentId = await ctx.db.insert("htmlArtifactContents", { content });
    if (row.content !== undefined) patch.content = undefined;
  }

  const hasContent = content.trim().length > 0;
  if (hasArtifactBody(row) !== hasContent) patch.hasContent = hasContent;

  if (Object.keys(patch).length > 0) await ctx.db.patch(row._id, patch);
}

export async function deleteHtmlBody(
  ctx: MutationCtx,
  row: Doc<"htmlArtifacts">,
): Promise<void> {
  if (row.contentId) await ctx.db.delete(row.contentId);
}
