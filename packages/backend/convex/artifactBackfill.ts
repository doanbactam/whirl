import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";

/**
 * One-shot migration: move artifact bodies out of `documents`/`htmlArtifacts`
 * and into their side tables (see convex/artifactContent.ts).
 *
 * New and freshly-edited rows migrate themselves on their next write, so this
 * only exists to catch everything that sits untouched — which, for a history
 * nobody revisits, is most of it. Until a row is swept it keeps its body inline
 * and every listing query keeps paying for it.
 *
 * Run it with:
 *   bunx convex run --% artifactBackfill:run "{}"
 *
 * Safe to re-run and safe to interrupt: rows are claimed by `contentId` being
 * unset, so a second pass skips everything the first one finished.
 */

// Each row moves its whole body, so keep batches small enough that one
// transaction stays well inside Convex's limits even with fat pages.
const BATCH = 20;

export const migrateDocuments = internalMutation({
  args: { batch: v.optional(v.number()) },
  handler: async (ctx, { batch }): Promise<{ migrated: number }> => {
    const rows = await ctx.db
      .query("documents")
      .withIndex("by_content_id", (q) => q.eq("contentId", undefined))
      .take(batch ?? BATCH);

    for (const row of rows) {
      const contentId = await ctx.db.insert("documentContents", {
        content: row.content ?? "",
      });
      await ctx.db.patch(row._id, {
        contentId,
        hasContent: (row.content?.trim().length ?? 0) > 0,
        // Drop the inline copy — leaving it would defeat the whole exercise.
        content: undefined,
      });
    }

    return { migrated: rows.length };
  },
});

export const migrateHtmlArtifacts = internalMutation({
  args: { batch: v.optional(v.number()) },
  handler: async (ctx, { batch }): Promise<{ migrated: number }> => {
    const rows = await ctx.db
      .query("htmlArtifacts")
      .withIndex("by_content_id", (q) => q.eq("contentId", undefined))
      .take(batch ?? BATCH);

    for (const row of rows) {
      const contentId = await ctx.db.insert("htmlArtifactContents", {
        content: row.content ?? "",
      });
      await ctx.db.patch(row._id, {
        contentId,
        hasContent: (row.content?.trim().length ?? 0) > 0,
        content: undefined,
      });
    }

    return { migrated: rows.length };
  },
});

/**
 * Move compaction summaries off thread rows. Unlike the artifact tables there's
 * no index that finds unmigrated rows — only a minority of threads have ever
 * been compacted — so this pages through the whole table once, which is a
 * cheaper one-off than the sidebar re-reading these forever.
 */
export const migrateCompactionSummaries = internalMutation({
  args: { cursor: v.optional(v.string()), batch: v.optional(v.number()) },
  handler: async (
    ctx,
    { cursor, batch },
  ): Promise<{ migrated: number; cursor: string | null }> => {
    const page = await ctx.db.query("threads").paginate({
      numItems: batch ?? BATCH,
      cursor: cursor ?? null,
    });

    let migrated = 0;
    for (const thread of page.page) {
      if (thread.compactionSummary === undefined) continue;
      const existing = await ctx.db
        .query("threadCompaction")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { summary: thread.compactionSummary });
      } else {
        await ctx.db.insert("threadCompaction", {
          threadId: thread._id,
          summary: thread.compactionSummary,
        });
      }
      await ctx.db.patch(thread._id, { compactionSummary: undefined });
      migrated += 1;
    }

    return { migrated, cursor: page.isDone ? null : page.continueCursor };
  },
});

/** Sweep everything until nothing is left to move. */
export const run = internalAction({
  args: { batch: v.optional(v.number()) },
  handler: async (
    ctx,
    { batch },
  ): Promise<{
    documents: number;
    htmlArtifacts: number;
    compactionSummaries: number;
  }> => {
    let documents = 0;
    let htmlArtifacts = 0;
    let compactionSummaries = 0;

    for (;;) {
      const { migrated } = await ctx.runMutation(
        internal.artifactBackfill.migrateDocuments,
        { batch },
      );
      if (migrated === 0) break;
      documents += migrated;
    }

    for (;;) {
      const { migrated } = await ctx.runMutation(
        internal.artifactBackfill.migrateHtmlArtifacts,
        { batch },
      );
      if (migrated === 0) break;
      htmlArtifacts += migrated;
    }

    let cursor: string | undefined;
    for (;;) {
      const page: { migrated: number; cursor: string | null } =
        await ctx.runMutation(
          internal.artifactBackfill.migrateCompactionSummaries,
          { batch, ...(cursor !== undefined ? { cursor } : {}) },
        );
      compactionSummaries += page.migrated;
      if (page.cursor === null) break;
      cursor = page.cursor;
    }

    return { documents, htmlArtifacts, compactionSummaries };
  },
});
