import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Autumn } from "autumn-js";
import { v } from "convex/values";

import { internal } from "../_generated/api";
import { internalQuery, type ActionCtx } from "../_generated/server";
import { AI_COST_FEATURE_ID, hasUsageBalance } from "../inference/billing";
import { chargeUsage } from "../usageLedger";
import { captureAiGeneration } from "../posthog";
import { APP_NAME, siteUrl } from "../site";
import {
  flushBraintrust,
  tracedGeneration,
  tracedGenerateText,
} from "../braintrust";
import {
  fetchSupermemoryPromptContext,
  isSupermemoryConfigured,
  supermemoryContainerTagForUser,
  type SupermemoryPromptContext,
} from "../supermemory";
import {
  contextSource,
  formatSuggestionContext,
  type SuggestionContext,
} from "./context";
import { pickFallbackSuggestions } from "./fallbacks";
import { parseSuggestions } from "./parse";
import { buildSuggestionPrompt, SUGGESTION_SYSTEM_PROMPT } from "./prompt";
import { sample } from "./random";
import { compactText } from "./text";
import type { HomeSuggestion, RecentThread } from "./types";

const SUGGESTION_MODEL_ID = "google/gemini-3.5-flash-lite";
const MAX_RECENT_THREADS = 6;
const MAX_THREAD_CANDIDATES = 25;
const MAX_MESSAGE_CHARS = 220;
/* A follow-up short enough to be "again" or "dang" says nothing about the
   conversation; the opening message already carries the subject. */
const MIN_LATEST_CHARS = 24;
/* Asked for exactly what we need, a batch loses a slot to every near-repeat
   the filter catches. Ask for a little more than we intend to keep. */
const CANDIDATE_HEADROOM = 2;

/* Rotated per request: the profile endpoint answers this query, so varying it
   surfaces a different slice of the user's memories each time. */
const MEMORY_QUERIES = [
  "What ongoing projects, unfinished tasks, or open problems would make useful next conversation suggestions for this user?",
  "What are this user's interests, tastes, and preferences?",
  "What has this user been building, learning, or deciding on lately?",
  "What tools, topics, and places matter to this user day to day?",
];

/** The action runtime cannot read Convex tables, so this bounded query gathers
 * the memory setting and the user's most recent conversations on its behalf. */
export const readContext = internalQuery({
  args: { userId: v.string() },
  handler: async (
    ctx,
    { userId },
  ): Promise<{
    memoryEnabled: boolean;
    recentThreads: RecentThread[];
  }> => {
    const [memorySettings, candidates] = await Promise.all([
      ctx.db
        .query("memorySettings")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
      ctx.db
        .query("threads")
        .withIndex("by_user_updated_at", (q) => q.eq("userId", userId))
        .order("desc")
        .take(MAX_THREAD_CANDIDATES),
    ]);

    const threads = candidates
      .filter((thread) => !thread.incognito)
      .slice(0, MAX_RECENT_THREADS);
    const recentThreads = await Promise.all(
      threads.map(async (thread) => {
        /* The opener is what the thread is *about*; the tail is usually
           "try now" / "again". Read both ends and keep the tail only when it
           has enough substance to add a second subject. */
        const userMessages = () =>
          ctx.db
            .query("messages")
            .withIndex("by_thread_role", (q) =>
              q.eq("threadId", thread._id).eq("role", "user"),
            );
        const [first, last] = await Promise.all([
          userMessages().first(),
          userMessages().order("desc").first(),
        ]);

        const opener = first
          ? compactText(first.content, MAX_MESSAGE_CHARS)
          : "";
        const tail =
          last && last._id !== first?._id
            ? compactText(last.content, MAX_MESSAGE_CHARS)
            : "";
        return {
          title: thread.title.trim() || "Untitled conversation",
          opener,
          latest: tail.length >= MIN_LATEST_CHARS ? tail : null,
        };
      }),
    );

    return {
      memoryEnabled: memorySettings?.enabled ?? true,
      /* A thread with no user message is a stub — nothing to suggest from. */
      recentThreads: recentThreads.filter((thread) => thread.opener.length > 0),
    };
  },
});

/** Both halves of what we know: the durable profile and this week's threads.
 * Memory failing is not fatal — the threads still describe the user. */
async function suggestionContext({
  ctx,
  userId,
}: {
  ctx: ActionCtx;
  userId: string;
}): Promise<SuggestionContext> {
  const stored: {
    memoryEnabled: boolean;
    recentThreads: RecentThread[];
  } = await ctx.runQuery(internal.suggestions.generate.readContext, { userId });

  let memory: SupermemoryPromptContext | null = null;
  if (stored.memoryEnabled && isSupermemoryConfigured()) {
    try {
      memory = await fetchSupermemoryPromptContext({
        containerTag: supermemoryContainerTagForUser(userId),
        query: sample(MEMORY_QUERIES, 1)[0]!,
      });
    } catch (error) {
      console.warn(
        "Home suggestions could not read Supermemory; using recent threads alone.",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { memory, threads: stored.recentThreads };
}

/** The provider's reported spend for one batch, or 0 when it can't be read. */
function reportedCost(metadata: unknown) {
  const cost = (metadata as { openrouter?: { usage?: { cost?: number } } })
    ?.openrouter?.usage?.cost;
  return typeof cost === "number" && cost > 0 ? cost : 0;
}

/** Bill a batch against the user's usage pool, plan-first. Suggestions are AI
 * token spend like any other, so they draw on `ai_cost` and overflow into the
 * purchased bucket — the same path inference and compaction take. */
async function billSuggestionBatch({
  ctx,
  customerId,
  cost,
  idempotencyKey,
}: {
  ctx: ActionCtx;
  customerId: string;
  cost: number;
  idempotencyKey: string;
}) {
  if (!(cost > 0)) return;
  const multiplierEvent = await ctx.runQuery(
    internal.admin.getActiveMultiplierInternal,
    {},
  );
  await chargeUsage(ctx, {
    customerId,
    idempotencyKey,
    feature: AI_COST_FEATURE_ID,
    amount: cost * (multiplierEvent?.multiplier ?? 1),
    source: "home_suggestions",
  });
}

/** One batch of starters for a user, personalized when we can pay for it and
 * drawn from the standby pool when we can't. Never throws: the home screen
 * always gets something to show.
 *
 * Asking for the whole batch in one call is what keeps them varied — within a
 * single response the model spreads across subjects, while separate
 * one-at-a-time calls over an unchanged context return the same top-ranked
 * idea reworded. */
export async function generateSuggestionBatch({
  ctx,
  userId,
  count,
  excluded,
}: {
  ctx: ActionCtx;
  userId: string;
  count: number;
  excluded: string[];
}): Promise<HomeSuggestion[]> {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterApiKey) {
    console.warn(
      "Home suggestions are using fallbacks: OPENROUTER_API_KEY is not set.",
    );
    return pickFallbackSuggestions(count, excluded);
  }

  /* Personalized starters are a paid extra, like thread titles and
     compaction: generate only against a pool that can cover the batch, and
     hand back standbys otherwise. */
  const autumnSecretKey = process.env.AUTUMN_SECRET_KEY;
  const autumn = autumnSecretKey
    ? new Autumn({ secretKey: autumnSecretKey })
    : null;
  if (autumn && !(await hasUsageBalance({ autumn, customerId: userId }))) {
    return pickFallbackSuggestions(count, excluded);
  }

  const context = await suggestionContext({ ctx, userId });
  const prompt = buildSuggestionPrompt({
    count: count + CANDIDATE_HEADROOM,
    context: formatSuggestionContext(context),
    excluded,
  });

  try {
    const openRouter = createOpenRouter({
      apiKey: openRouterApiKey,
      appName: APP_NAME,
      appUrl: siteUrl(),
    });
    const startedAt = Date.now();
    const { text, usage, providerMetadata } = await tracedGeneration(
      {
        userId,
        eventId: `home-suggestions:${userId}:${startedAt}`,
        eventName: "home_suggestions",
        properties: {
          model: SUGGESTION_MODEL_ID,
          context_source: contextSource(context),
          requested_count: count,
        },
      },
      () =>
        tracedGenerateText({
          model: openRouter.chat(SUGGESTION_MODEL_ID),
          system: SUGGESTION_SYSTEM_PROMPT,
          prompt,
          maxOutputTokens: 120 * (count + CANDIDATE_HEADROOM),
          temperature: 0.9,
          providerOptions: { openrouter: { usage: { include: true } } },
        }),
    );

    /* Billed before parsing: the provider charged for the batch whether or
       not its JSON turns out to be usable. */
    if (autumn) {
      await billSuggestionBatch({
        ctx,
        customerId: userId,
        cost: reportedCost(providerMetadata),
        idempotencyKey: `home-suggestions:${userId}:${startedAt}`,
      });
    }

    const suggestions = parseSuggestions({ text, limit: count, excluded });

    await captureAiGeneration({
      distinctId: userId,
      traceId: `home-suggestions-${startedAt}`,
      model: SUGGESTION_MODEL_ID,
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      spanName: "home_suggestions",
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      latencySeconds: (Date.now() - startedAt) / 1000,
      properties: {
        context_source: contextSource(context),
        requested_count: count,
        returned_count: suggestions.length,
      },
    });

    if (suggestions.length === 0) {
      throw new Error("Suggestion response had no usable suggestions.");
    }
    /* A short batch is fine — the reserve just runs out sooner. An empty one
       is not, and falls through to the standbys. */
    return suggestions;
  } catch (error) {
    console.warn(
      "Home suggestion generation failed; using fallbacks.",
      error instanceof Error ? error.message : error,
    );
    return pickFallbackSuggestions(count, excluded);
  } finally {
    await flushBraintrust();
  }
}
