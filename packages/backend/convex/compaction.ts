import { type ModelMessage } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Autumn } from "autumn-js";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  readCompactionSummary,
  writeCompactionSummary,
} from "./threadCompaction";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  AI_COST_FEATURE_ID,
  deductUsageWithOverflow,
  hasUsageBalance,
  isPaidCustomer,
} from "./inference/billing";
import { APP_NAME, siteUrl } from "./site";
import { chargeUsage } from "./usageLedger";
import {
  flushBraintrust,
  tracedGeneration,
  tracedGenerateText,
} from "./braintrust";

export const COMPACTION_MODEL_ID = "google/gemini-3.5-flash";
export const COMPACTION_TOKEN_THRESHOLD = 100_000;

const COMPACTION_SYSTEM_PROMPT = [
  "You are summarizing a long chat thread for continuation.",
  "Preserve the user's goals, constraints, intermediate decisions, open questions, code snippets, file names, and key facts.",
  "Write a dense summary in plain prose. Do not role-play or add new content.",
  "If a prior summary is provided, merge it with the new messages into one coherent summary.",
].join(" ");

export function estimateTokensFromChars(charCount: number) {
  return Math.ceil(charCount / 4);
}

export function estimateThreadTokens({
  summary,
  messages,
}: {
  summary?: string;
  messages: { content: string }[];
}) {
  let chars = summary?.length ?? 0;
  for (const message of messages) {
    chars += message.content.length;
  }
  return estimateTokensFromChars(chars);
}

async function getOwnedThread(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> }; db: any }, threadId: string) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Not authenticated");
  }
  const thread = await ctx.db.get(threadId);
  if (!thread || thread.userId !== identity.subject) {
    throw new Error("Thread not found");
  }
  return { thread, userId: identity.subject };
}

export const getCompactionPayload = internalQuery({
  args: {
    threadId: v.id("threads"),
    customerId: v.string(),
  },
  handler: async (ctx, { threadId, customerId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== customerId) {
      throw new Error("Thread not found");
    }

    let boundaryCreatedAt = 0;
    if (thread.compactionBoundary) {
      const boundaryMessage = await ctx.db.get(thread.compactionBoundary);
      if (boundaryMessage) {
        boundaryCreatedAt = boundaryMessage.createdAt;
      }
    }

    const [messages, latestMessage] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_thread_created_at", (q) =>
          q.eq("threadId", threadId).gt("createdAt", boundaryCreatedAt),
        )
        .collect(),
      ctx.db
        .query("messages")
        .withIndex("by_thread_created_at", (q) => q.eq("threadId", threadId))
        .order("desc")
        .first(),
    ]);

    const toSummarize = messages.map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
      createdAt: message.createdAt,
    }));

    if (!latestMessage) {
      throw new Error("Thread has no messages to compact");
    }

    return {
      existingSummary: await readCompactionSummary(ctx, thread),
      messages: toSummarize,
      boundaryMessageId: latestMessage._id,
      compactionStatus: thread.compactionStatus ?? "idle",
    };
  },
});

export const getThreadForCustomer = internalQuery({
  args: {
    threadId: v.id("threads"),
    customerId: v.string(),
  },
  handler: async (ctx, { threadId, customerId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== customerId) {
      return null;
    }
    return {
      compactionStatus: thread.compactionStatus ?? "idle",
      locked: Boolean(thread.lock),
    };
  },
});

export const getThreadCompactionState = internalQuery({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      return null;
    }

    let boundaryCreatedAt = 0;
    if (thread.compactionBoundary) {
      const boundaryMessage = await ctx.db.get(thread.compactionBoundary);
      if (boundaryMessage) {
        boundaryCreatedAt = boundaryMessage.createdAt;
      }
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_created_at", (q) =>
        q.eq("threadId", threadId).gt("createdAt", boundaryCreatedAt),
      )
      .collect();

    const compactionSummary = await readCompactionSummary(ctx, thread);
    return {
      compactionStatus: thread.compactionStatus ?? "idle",
      compactionSummary,
      estimatedTokens: estimateThreadTokens({
        summary: compactionSummary,
        messages,
      }),
      userId: thread.userId,
    };
  },
});

export const markCompacting = internalMutation({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }
    if (thread.compactionStatus === "compacting") {
      return { started: false };
    }
    // Backstop for the check in `compactThread` below — nothing may flip a
    // locked thread into compacting, whatever route it came in by.
    if (thread.lock) {
      throw new ConvexError("You cannot compact a locked chat.");
    }
    await ctx.db.patch(threadId, {
      compactionStatus: "compacting",
      compactionUpdatedAt: Date.now(),
    });
    return { started: true };
  },
});

export const applyCompactionResult = internalMutation({
  args: {
    threadId: v.id("threads"),
    summary: v.string(),
    boundary: v.id("messages"),
    cost: v.number(),
    extraCost: v.optional(v.number()),
  },
  handler: async (ctx, { threadId, summary, boundary, cost, extraCost }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }
    const now = Date.now();
    const nextCost = (thread.compactionCost ?? 0) + cost;
    const usageLog = [...(thread.compactionUsage ?? [])];
    if (cost > 0) {
      usageLog.push({
        cost,
        createdAt: now,
        ...(extraCost && extraCost > 0 ? { extraCost } : {}),
      });
    }
    const markers = [
      ...(thread.compactionMarkers ?? []),
      { messageId: boundary, createdAt: now },
    ];
    // The summary goes to its own row so the sidebar never reads it again.
    await writeCompactionSummary(ctx, thread, summary);
    await ctx.db.patch(threadId, {
      compactionBoundary: boundary,
      compactionStatus: "ready",
      compactionCost: nextCost,
      compactionUpdatedAt: now,
      compactionUsage: usageLog,
      compactionMarkers: markers,
    });
  },
});

export const clearCompactionStatus = internalMutation({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      return;
    }
    const summary = await readCompactionSummary(ctx, thread);
    await ctx.db.patch(threadId, {
      compactionStatus: summary ? "ready" : "idle",
      compactionUpdatedAt: Date.now(),
    });
  },
});

function formatMessagesForSummary(
  messages: { role: "user" | "assistant"; content: string }[],
) {
  return messages
    .map((message) => {
      const label = message.role === "user" ? "User" : "Assistant";
      return `${label}: ${message.content}`;
    })
    .join("\n\n");
}

export const runCompaction = internalAction({
  args: {
    threadId: v.id("threads"),
    customerId: v.string(),
  },
  handler: async (ctx, { threadId, customerId }) => {
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    const autumnSecretKey = process.env.AUTUMN_SECRET_KEY;
    if (!openRouterApiKey) {
      await ctx.runMutation(internal.compaction.clearCompactionStatus, {
        threadId,
      });
      return;
    }

    if (autumnSecretKey) {
      const autumn = new Autumn({ secretKey: autumnSecretKey });
      const paid = await isPaidCustomer({ autumn, customerId });
      if (!paid) {
        await ctx.runMutation(internal.compaction.clearCompactionStatus, {
          threadId,
        });
        return;
      }
    }

    let payload: {
      existingSummary?: string;
      messages: { role: "user" | "assistant"; content: string; createdAt: number }[];
      boundaryMessageId: Id<"messages">;
      compactionStatus: string;
    };
    try {
      payload = await ctx.runQuery(internal.compaction.getCompactionPayload, {
        threadId,
        customerId,
      });
    } catch {
      await ctx.runMutation(internal.compaction.clearCompactionStatus, {
        threadId,
      });
      return;
    }

    if (payload.messages.length === 0) {
      await ctx.runMutation(internal.compaction.clearCompactionStatus, {
        threadId,
      });
      return;
    }

    const conversationBlock = formatMessagesForSummary(payload.messages);
    const promptParts = [
      payload.existingSummary
        ? `Prior summary:\n${payload.existingSummary}`
        : null,
      `Messages to incorporate:\n${conversationBlock}`,
    ].filter(Boolean);

    const modelMessages: ModelMessage[] = [
      {
        role: "user",
        content: promptParts.join("\n\n"),
      },
    ];

    try {
      const openRouter = createOpenRouter({
        apiKey: openRouterApiKey,
        appName: APP_NAME,
        appUrl: siteUrl(),
      });
      const model = openRouter.chat(COMPACTION_MODEL_ID);

      const result = await tracedGeneration(
        {
          userId: customerId,
          eventId: `${threadId}:compact:${payload.boundaryMessageId}`,
          convoId: threadId,
          eventName: "thread_compaction",
          properties: { model: COMPACTION_MODEL_ID },
        },
        () =>
          tracedGenerateText({
            model,
            system: COMPACTION_SYSTEM_PROMPT,
            messages: modelMessages,
            temperature: 0.2,
            providerOptions: {
              openrouter: {
                usage: { include: true },
              },
            },
          }),
      );

      const summary = result.text.trim();
      if (!summary) {
        throw new Error("Compaction returned an empty summary");
      }

      let cost = 0;
      const meta = (await result.providerMetadata) as
        | { openrouter?: { usage?: { cost?: number } } }
        | undefined;
      const reported = meta?.openrouter?.usage?.cost;
      if (typeof reported === "number" && reported > 0) {
        cost = reported;
      }

      let extraCost = 0;
      if (autumnSecretKey && cost > 0) {
        // Scale the compaction deduction by any active usage-multiplier event,
        // mirroring the inference deduction path.
        const multiplierEvent = await ctx.runQuery(
          internal.admin.getActiveMultiplierInternal,
          {},
        );
        const usageFactor = multiplierEvent?.multiplier ?? 1;
        const idempotencyKey = `${threadId}:compact:${payload.boundaryMessageId}`;
        try {
          // Compaction is AI token spend, so it bills plan-first via `ai_cost`
          // and overflows into the extra-usage bucket — same as inference.
          const { extraPortion } = await deductUsageWithOverflow({
            autumn: new Autumn({ secretKey: autumnSecretKey }),
            customerId,
            amount: cost * usageFactor,
            primaryFeatureId: AI_COST_FEATURE_ID,
            idempotencyKey,
          });
          extraCost = extraPortion;
        } catch {
          // Autumn wouldn't take it right now. Hand the charge to the ledger
          // to retry rather than throwing away a summary that's already
          // written and paid for — the same key, so it can't double-bill.
          await chargeUsage(ctx, {
            customerId,
            idempotencyKey,
            feature: AI_COST_FEATURE_ID,
            amount: cost * usageFactor,
            source: "compaction",
          });
        }
      }

      await ctx.runMutation(internal.compaction.applyCompactionResult, {
        threadId,
        summary,
        boundary: payload.boundaryMessageId,
        cost,
        extraCost,
      });
    } catch {
      await ctx.runMutation(internal.compaction.clearCompactionStatus, {
        threadId,
      });
    } finally {
      await flushBraintrust();
    }
  },
});

export const compactThread = action({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, { threadId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError("Not authenticated");
    }
    const userId = identity.subject;

    const thread = await ctx.runQuery(internal.compaction.getThreadForCustomer, {
      threadId,
      customerId: userId,
    });
    if (!thread) {
      throw new Error("Thread not found");
    }
    if (thread.compactionStatus === "compacting") {
      return { started: false };
    }
    // Compaction is a model reading the whole conversation and writing a prose
    // summary of it into our tables — the two things a locked thread rules out.
    if (thread.locked) {
      throw new ConvexError("You cannot compact a locked chat.");
    }

    const autumnSecretKey = process.env.AUTUMN_SECRET_KEY;
    if (autumnSecretKey) {
      const autumn = new Autumn({ secretKey: autumnSecretKey });
      const paid = await isPaidCustomer({ autumn, customerId: userId });
      if (!paid) {
        throw new Error("Compaction is on paid plans.");
      }
      // Allowed while either the plan pool or the extra-usage bucket has budget.
      const allowed = await hasUsageBalance({ autumn, customerId: userId });
      if (!allowed) {
        throw new Error("Not enough usage to compact this thread.");
      }
    }

    const mark = await ctx.runMutation(internal.compaction.markCompacting, {
      threadId,
    });
    if (!mark.started) {
      return { started: false };
    }

    await ctx.scheduler.runAfter(0, internal.compaction.runCompaction, {
      threadId,
      customerId: userId,
    });

    return { started: true };
  },
});

export const maybeScheduleCompaction = internalMutation({
  args: {
    threadId: v.id("threads"),
    customerId: v.string(),
  },
  handler: async (ctx, { threadId, customerId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread) {
      return { scheduled: false };
    }
    if (thread.compactionStatus === "compacting") {
      return { scheduled: false };
    }

    let boundaryCreatedAt = 0;
    if (thread.compactionBoundary) {
      const boundaryMessage = await ctx.db.get(thread.compactionBoundary);
      if (boundaryMessage) {
        boundaryCreatedAt = boundaryMessage.createdAt;
      }
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_created_at", (q) =>
        q.eq("threadId", threadId).gt("createdAt", boundaryCreatedAt),
      )
      .collect();

    const estimatedTokens = estimateThreadTokens({
      summary: await readCompactionSummary(ctx, thread),
      messages,
    });

    if (estimatedTokens < COMPACTION_TOKEN_THRESHOLD) {
      return { scheduled: false };
    }

    await ctx.db.patch(threadId, {
      compactionStatus: "compacting",
      compactionUpdatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.compaction.runCompaction, {
      threadId,
      customerId,
    });

    return { scheduled: true };
  },
});
