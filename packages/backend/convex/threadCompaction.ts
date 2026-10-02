import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * A thread's compaction summary, kept off the thread row. Same reasoning as
 * convex/artifactContent.ts: the sidebar reads EVERY thread a user owns on
 * every run, and a summary is a multi-KB block of prose that nothing in the
 * sidebar renders — it exists only to be fed back into the model.
 *
 * Everything else about compaction stays on the thread. The status, boundary,
 * timestamp and running cost are scalars; a marker is two numbers; and the
 * usage log is a handful of small entries that the usage page wants alongside
 * the threads it's already reading. None of them are worth a join.
 *
 * Rows written before the split keep their summary on the thread; reads fall
 * back to it and the next compaction migrates it. See
 * `convex/artifactBackfill.ts` for the sweep.
 */

type AnyCtx = QueryCtx | MutationCtx;

async function summaryRow(ctx: AnyCtx, threadId: Id<"threads">) {
  return await ctx.db
    .query("threadCompaction")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .unique();
}

/** A thread's compaction summary, wherever it currently lives. */
export async function readCompactionSummary(
  ctx: AnyCtx,
  thread: Doc<"threads">,
): Promise<string | undefined> {
  const row = await summaryRow(ctx, thread._id);
  if (row) return row.summary;
  return thread.compactionSummary;
}

/**
 * Upsert a thread's compaction summary, clearing the legacy copy off the
 * thread row on the way past so it never carries one again.
 */
export async function writeCompactionSummary(
  ctx: MutationCtx,
  thread: Doc<"threads">,
  summary: string,
): Promise<void> {
  const existing = await summaryRow(ctx, thread._id);
  if (existing) {
    await ctx.db.patch(existing._id, { summary });
  } else {
    await ctx.db.insert("threadCompaction", { threadId: thread._id, summary });
  }

  if (thread.compactionSummary !== undefined) {
    await ctx.db.patch(thread._id, { compactionSummary: undefined });
  }
}

/**
 * Forget a thread's summary — used when a rollback deletes the boundary it
 * condensed up to, so inference goes back to reading the real messages.
 */
export async function clearCompactionSummary(
  ctx: MutationCtx,
  threadId: Id<"threads">,
): Promise<void> {
  const row = await summaryRow(ctx, threadId);
  if (row) await ctx.db.delete(row._id);
}
