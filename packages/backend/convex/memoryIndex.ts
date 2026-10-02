import { Autumn } from "autumn-js";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { isPaidCustomer } from "./inference/billing";
import { captureServerEvent } from "./posthog";
import {
  addSupermemoryDocument,
  isSupermemoryConfigured,
  supermemoryContainerTagForUser,
} from "./supermemory";

// One index per rolling 24h, per user, on paid plans.
export const INDEX_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// A "running" row older than this is treated as dead (the action crashed) so it
// neither blocks a new run nor shows a stuck progress bar forever.
const STALE_RUN_MS = 30 * 60 * 1000;

// Safety bound on a single run so a user with a huge history can't kick off an
// unbounded sweep. The most-recently-touched threads are scanned first.
const MAX_THREADS_PER_RUN = 300;

// Per-thread transcript cap (chars). Supermemory extracts from uploaded
// documents asynchronously, but we still bound each sync; when over, keep the
// most recent tail of the chat.
const MAX_TRANSCRIPT_CHARS = 16_000;

type IndexRunView = {
  status: "running" | "complete" | "failed";
  startedAt: number;
  finishedAt: number | null;
  totalThreads: number;
  processedThreads: number;
  addedCount: number;
};

async function latestRunFor(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query("memoryIndexRuns")
    .withIndex("by_user_started_at", (q) => q.eq("userId", userId))
    .order("desc")
    .first();
}

// The cutoff for an incremental run: the start time of the most recent run that
// actually completed. Threads touched after this are the only ones rescanned.
// Failed runs don't move the cutoff, so a retry re-covers what they missed.
async function lastCompleteStartedAt(
  ctx: QueryCtx,
  userId: string,
): Promise<number> {
  const recent = await ctx.db
    .query("memoryIndexRuns")
    .withIndex("by_user_started_at", (q) => q.eq("userId", userId))
    .order("desc")
    .take(30);
  const lastComplete = recent.find((run) => run.status === "complete");
  return lastComplete?.startedAt ?? 0;
}

async function collectThreadIdsSince(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  cutoff: number,
): Promise<Id<"threads">[]> {
  const threads = await ctx.db
    .query("threads")
    .withIndex("by_user_updated_at", (q) =>
      q.eq("userId", userId).gt("updatedAt", cutoff),
    )
    .order("desc")
    .take(MAX_THREADS_PER_RUN);
  return threads.map((thread) => thread._id);
}

/**
 * The signed-in user's memory sync state for the settings UI: whether a run is
 * live (with its progress), when the next run unlocks, and the last result.
 */
export const getStatus = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    isRunning: boolean;
    nextAvailableAt: number | null;
    lastRun: IndexRunView | null;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const latest = await latestRunFor(ctx, identity.subject);
    const now = Date.now();
    if (!latest) {
      return { isRunning: false, nextAvailableAt: null, lastRun: null };
    }

    const isRunning =
      latest.status === "running" && now - latest.startedAt < STALE_RUN_MS;
    const cooldownEnds =
      latest.status === "complete" ? latest.startedAt + INDEX_COOLDOWN_MS : null;

    return {
      isRunning,
      nextAvailableAt:
        cooldownEnds && cooldownEnds > now ? cooldownEnds : null,
      lastRun: {
        status: latest.status,
        startedAt: latest.startedAt,
        finishedAt: latest.finishedAt ?? null,
        totalThreads: latest.totalThreads,
        processedThreads: latest.processedThreads,
        addedCount: latest.addedCount,
      },
    };
  },
});

/**
 * Open a new run if the user is eligible, returning its id. Returns
 * `{ runId: null, reason }` instead of throwing for the soft cases the UI
 * surfaces as a toast (cooldown, already running, nothing new to scan).
 */
export const beginRun = internalMutation({
  args: { userId: v.string() },
  handler: async (
    ctx,
    { userId },
  ): Promise<{ runId: Id<"memoryIndexRuns"> | null; reason?: string }> => {
    const now = Date.now();

    // Respect the memory switch; when it's off, Supermemory retrieval and writes
    // are paused, so a sync sweep would be pointless. Default row absence is on.
    const memorySettings = await ctx.db
      .query("memorySettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (memorySettings && !memorySettings.enabled) {
      return { runId: null, reason: "disabled" };
    }

    const latest = await latestRunFor(ctx, userId);

    if (latest) {
      const isRunning =
        latest.status === "running" && now - latest.startedAt < STALE_RUN_MS;
      if (isRunning) {
        return { runId: null, reason: "running" };
      }
      if (
        latest.status === "complete" &&
        now - latest.startedAt < INDEX_COOLDOWN_MS
      ) {
        return { runId: null, reason: "cooldown" };
      }
      // A stale "running" row means the action died — retire it so it stops
      // lingering as in-progress.
      if (latest.status === "running") {
        await ctx.db.patch(latest._id, {
          status: "failed",
          finishedAt: now,
          error: "timed out",
        });
      }
    }

    const cutoff = await lastCompleteStartedAt(ctx, userId);
    const threadIds = await collectThreadIdsSince(ctx, userId, cutoff);
    if (threadIds.length === 0) {
      return { runId: null, reason: "empty" };
    }

    const runId = await ctx.db.insert("memoryIndexRuns", {
      userId,
      status: "running",
      startedAt: now,
      cutoff,
      totalThreads: threadIds.length,
      processedThreads: 0,
      addedCount: 0,
    });
    return { runId };
  },
});

export const getRun = internalQuery({
  args: { runId: v.id("memoryIndexRuns") },
  handler: async (ctx, { runId }) => ctx.db.get(runId),
});

export const listThreadIdsSince = internalQuery({
  args: { userId: v.string(), cutoff: v.number() },
  handler: async (ctx, { userId, cutoff }): Promise<Id<"threads">[]> =>
    collectThreadIdsSince(ctx, userId, cutoff),
});

/** A thread's transcript (user + completed assistant turns) for the indexer. */
export const getThreadTranscript = internalQuery({
  args: { threadId: v.id("threads"), userId: v.string() },
  handler: async (
    ctx,
    { threadId, userId },
  ): Promise<{ role: "user" | "assistant"; content: string }[]> => {
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== userId) return [];

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_created_at", (q) => q.eq("threadId", threadId))
      .collect();

    return messages
      .filter((message) => {
        if (message.content.trim().length === 0) return false;
        // Keep user turns and only assistant turns that finished cleanly.
        if (message.role === "assistant") {
          return message.status === undefined || message.status === "complete";
        }
        return true;
      })
      .map((message) => ({ role: message.role, content: message.content }));
  },
});

export const recordProgress = internalMutation({
  args: {
    runId: v.id("memoryIndexRuns"),
    addedDelta: v.number(),
    totalThreads: v.optional(v.number()),
  },
  handler: async (ctx, { runId, addedDelta, totalThreads }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    await ctx.db.patch(runId, {
      processedThreads: run.processedThreads + 1,
      addedCount: run.addedCount + addedDelta,
      ...(totalThreads !== undefined ? { totalThreads } : {}),
    });
  },
});

export const setTotal = internalMutation({
  args: { runId: v.id("memoryIndexRuns"), totalThreads: v.number() },
  handler: async (ctx, { runId, totalThreads }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    await ctx.db.patch(runId, { totalThreads });
  },
});

export const finalizeRun = internalMutation({
  args: {
    runId: v.id("memoryIndexRuns"),
    status: v.union(v.literal("complete"), v.literal("failed")),
    cost: v.optional(v.number()),
    extraCost: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { runId, status, cost, extraCost, error }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    await ctx.db.patch(runId, {
      status,
      finishedAt: Date.now(),
      ...(cost !== undefined ? { cost } : {}),
      ...(extraCost !== undefined ? { extraCost } : {}),
      ...(error !== undefined ? { error } : {}),
    });
  },
});

function buildTranscript(
  messages: { role: "user" | "assistant"; content: string }[],
): string {
  const full = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  // Keep the most recent tail when a thread is very long.
  return full.length > MAX_TRANSCRIPT_CHARS
    ? full.slice(full.length - MAX_TRANSCRIPT_CHARS)
    : full;
}

/**
 * The sweep itself: visit each thread touched since the last run and upload a
 * bounded transcript document to Supermemory. Supermemory owns extraction and
 * search, while the run row only tracks sync progress for the settings UI.
 */
export const processRun = internalAction({
  args: { runId: v.id("memoryIndexRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.runQuery(internal.memoryIndex.getRun, { runId });
    if (!run || run.status !== "running") return;
    const { userId } = run;

    if (!isSupermemoryConfigured()) {
      await ctx.runMutation(internal.memoryIndex.finalizeRun, {
        runId,
        status: "failed",
        error: "Missing SUPERMEMORY_API_KEY",
      });
      return;
    }

    try {
      const threadIds = await ctx.runQuery(
        internal.memoryIndex.listThreadIdsSince,
        { userId, cutoff: run.cutoff },
      );
      await ctx.runMutation(internal.memoryIndex.setTotal, {
        runId,
        totalThreads: threadIds.length,
      });

      if (threadIds.length === 0) {
        await ctx.runMutation(internal.memoryIndex.finalizeRun, {
          runId,
          status: "complete",
          cost: 0,
        });
        return;
      }

      const containerTag = supermemoryContainerTagForUser(userId);
      let totalSynced = 0;

      for (const threadId of threadIds) {
        let threadSynced = 0;
        try {
          const transcript = await ctx.runQuery(
            internal.memoryIndex.getThreadTranscript,
            { threadId, userId },
          );
          if (transcript.length > 0) {
            await addSupermemoryDocument({
              containerTag,
              customId: `whirl-thread-${threadId}`,
              content: `Whirl chat transcript\n\n${buildTranscript(transcript)}`,
              metadata: {
                type: "thread_transcript",
                source: "whirl",
                threadId,
                syncedAt: Date.now(),
              },
            });
            threadSynced = 1;
          }
        } catch (error) {
          // One thread failing shouldn't sink the whole sync; record it as
          // processed and move on.
          console.error("Supermemory thread sync failed", { threadId, error });
        }

        totalSynced += threadSynced;
        await ctx.runMutation(internal.memoryIndex.recordProgress, {
          runId,
          addedDelta: threadSynced,
        });
      }

      await ctx.runMutation(internal.memoryIndex.finalizeRun, {
        runId,
        status: "complete",
        cost: 0,
      });

      await captureServerEvent({
        event: "memory_index_completed",
        distinctId: userId,
        properties: {
          provider: "supermemory",
          threads: threadIds.length,
          added: totalSynced,
          synced: totalSynced,
          cost: 0,
        },
      });
    } catch (error) {
      await ctx.runMutation(internal.memoryIndex.finalizeRun, {
        runId,
        status: "failed",
        error: error instanceof Error ? error.message : "Memory index failed",
      });
    }
  },
});

/**
 * Kick off a memory sync for the signed-in user. Paid-only, then capped to one
 * run per rolling 24h. Returns a `reason` for the soft cases the UI surfaces as
 * a toast.
 */
export const start = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ started: boolean; reason?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject;

    const autumnSecretKey = process.env.AUTUMN_SECRET_KEY;
    if (autumnSecretKey) {
      const autumn = new Autumn({ secretKey: autumnSecretKey });
      const paid = await isPaidCustomer({ autumn, customerId: userId });
      if (!paid) return { started: false, reason: "paid" };
    }

    const { runId, reason } = await ctx.runMutation(
      internal.memoryIndex.beginRun,
      { userId },
    );
    if (!runId) return { started: false, reason };

    await ctx.scheduler.runAfter(0, internal.memoryIndex.processRun, { runId });
    return { started: true };
  },
});
