import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { resolveSendModel } from "./models";
import {
  appendUserTurn,
  displayNameFromIdentity,
  isThreadRunning,
  verifyMentions,
} from "./turns";
import {
  attachmentValidator,
  integrationMentionValidator,
  sendOptionsValidator,
  skillMentionValidator,
} from "./validators";

/* Messages queued behind a reply that's still being written.

   The queue lives here, in the database, and not in the tab that typed
   the message: replies are written by the deployment (W-134), so the tab
   might be on another thread, or closed, by the time this one is due.
   Every path that settles a reply — the stream handler, a Stop click, the
   watchdog — calls `drainQueuedMessages`, which sends the oldest waiting
   message the same way the composer would have. One message per settle:
   its own reply settles next, and the queue moves on from there. */

/* Enough for anyone typing ahead; a cap so a stuck thread can't collect
   an unbounded pile of turns to burn through the moment it unsticks. */
const MAX_QUEUED_PER_THREAD = 10;

async function currentUserId(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Not authenticated");
  }
  return identity.subject;
}

async function ownedThread(ctx: QueryCtx | MutationCtx, threadId: Id<"threads">) {
  const userId = await currentUserId(ctx);
  const thread = await ctx.db.get(threadId);
  if (!thread || thread.userId !== userId) {
    throw new Error("Thread not found");
  }
  return { thread, userId };
}

function queuedFor(ctx: QueryCtx | MutationCtx, threadId: Id<"threads">) {
  return ctx.db
    .query("queuedMessages")
    .withIndex("by_thread_created_at", (q) => q.eq("threadId", threadId));
}

/* What the transcript draws for a waiting message. Attachments shed the
   storage pointers and extracted text — the card only names the file. */
function formatQueued(row: Doc<"queuedMessages">) {
  return {
    id: row._id,
    content: row.content,
    createdAt: row.createdAt,
    attachments: (row.attachments ?? []).map(({ id, name, size, type }) => ({
      id,
      name,
      size,
      type,
    })),
    model: row.options?.model ?? null,
  };
}

export const listForThread = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    await ownedThread(ctx, threadId);
    const rows = await queuedFor(ctx, threadId).take(MAX_QUEUED_PER_THREAD);
    return rows.map(formatQueued);
  },
});

export const enqueue = mutation({
  args: {
    threadId: v.id("threads"),
    content: v.string(),
    attachments: v.optional(v.array(attachmentValidator)),
    integrations: v.optional(v.array(integrationMentionValidator)),
    skills: v.optional(v.array(skillMentionValidator)),
    options: v.optional(sendOptionsValidator),
  },
  handler: async (
    ctx,
    { threadId, content, attachments, integrations, skills, options },
  ) => {
    const { thread, userId } = await ownedThread(ctx, threadId);
    // A locked chat's replies are written by the tab holding the key, and
    // nothing server-side can start one — so nothing server-side can wait
    // for one either.
    if (thread.lock) {
      throw new ConvexError("This chat is locked. Unlock it first.");
    }

    const waiting = await queuedFor(ctx, threadId).take(MAX_QUEUED_PER_THREAD);
    if (waiting.length >= MAX_QUEUED_PER_THREAD) {
      throw new ConvexError(
        `You can queue up to ${MAX_QUEUED_PER_THREAD} messages. Let the reply catch up first.`,
      );
    }

    const { mentions, skillMentions } = await verifyMentions(
      ctx,
      userId,
      integrations,
      skills,
    );
    const queuedId = await ctx.db.insert("queuedMessages", {
      threadId,
      userId,
      content,
      attachments,
      ...(mentions ? { integrations: mentions } : {}),
      ...(skillMentions ? { skills: skillMentions } : {}),
      options,
      // Captured now, while there's an identity to read it from: the drain
      // runs from a settle with no caller behind it.
      userName: await displayNameFromIdentity(ctx),
      createdAt: Date.now(),
    });

    // The reply may have finished between the composer's check and this
    // write — then there's nothing to wait for, and the message goes now.
    const sentNow = await drainQueuedMessages(ctx, threadId);
    return { queuedId, sentNow };
  },
});

export const remove = mutation({
  args: { queuedId: v.id("queuedMessages") },
  handler: async (ctx, { queuedId }) => {
    const userId = await currentUserId(ctx);
    const row = await ctx.db.get(queuedId);
    // Already sent (or already removed): nothing to take back.
    if (!row) return null;
    if (row.userId !== userId) {
      throw new Error("Queued message not found");
    }
    await ctx.db.delete(queuedId);
    return null;
  },
});

/** Every settle path calls this through the mutation that wrote the
 *  terminal status; the cron and the client's Stop go through here too. */
export const drain = internalMutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    return await drainQueuedMessages(ctx, threadId);
  },
});

/**
 * Send the oldest queued message, if the thread has nothing in flight.
 * Returns whether one went out. Safe to call from any settle, however many
 * times: a running reply (including the one this just started) means no-op.
 */
export async function drainQueuedMessages(
  ctx: MutationCtx,
  threadId: Id<"threads">,
): Promise<boolean> {
  const next = await queuedFor(ctx, threadId).order("asc").first();
  if (!next) return false;

  const thread = await ctx.db.get(threadId);
  // Locked since it was queued: the server can't start this reply, and
  // the row would only ever sit here. Let it go.
  if (!thread || thread.lock) {
    await ctx.db.delete(next._id);
    return false;
  }
  if (await isThreadRunning(ctx, threadId)) return false;

  await ctx.db.delete(next._id);
  const now = Date.now();
  // Same resolution a fresh send gets: a catalog model removed while this
  // waited quietly rides as Auto rather than failing the turn.
  const model = await resolveSendModel(ctx.db, next.options?.model);
  await ctx.db.patch(threadId, { updatedAt: now, model });
  await appendUserTurn(ctx, {
    threadId,
    userId: next.userId,
    content: next.content,
    attachments: next.attachments,
    mentions: next.integrations,
    skillMentions: next.skills,
    options: next.options,
    model,
    userName: next.userName,
    now,
  });
  return true;
}

/** Thread deletion and the incognito purge take the queue with them. */
export async function deleteQueuedForThread(
  ctx: MutationCtx,
  threadId: Id<"threads">,
) {
  const rows = await queuedFor(ctx, threadId).take(MAX_QUEUED_PER_THREAD);
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
}
