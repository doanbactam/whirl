import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { captureAiGeneration } from "./posthog";
import { APP_NAME, siteUrl } from "./site";
import {
  flushBraintrust,
  tracedGeneration,
  tracedGenerateText,
} from "./braintrust";
import { isStoreCategory, STORE_CATEGORIES } from "./storeCategories";

// Sorts store listings onto shelves. Listings arrive without a category
// (developers never pick one); a lightweight model reads name + description
// (+ tool names, for integrations) and files each one under a shelf from
// storeCategories.ts. The verdict is cached on the row, so every listing is
// classified exactly once: the sweep below only ever sees uncategorized rows,
// runs one batched call for all of them, and skips the model entirely when
// there's nothing new. Triggered after every console approval and by a cron
// backfill (crons.ts) for rows that slipped past (e.g. admin-added Composio
// extensions, which skip the approval queue).

const CATEGORIZE_MODEL_ID = "google/gemini-2.5-flash-lite";
// Per-run cap keeps the prompt small; the cron sweep catches any remainder.
const MAX_BATCH = 80;

type Entry = {
  kind: "integration" | "skill";
  id: string;
  name: string;
  description?: string;
  toolNames?: string[];
};

/** Approved, enabled listings that don't have a shelf yet — both kinds. */
export const listUncategorized = internalQuery({
  args: {},
  handler: async (ctx): Promise<Entry[]> => {
    const integrations = await ctx.db
      .query("integrations")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .take(500);
    const skills = await ctx.db
      .query("skills")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .take(500);

    const entries: Entry[] = [];
    for (const row of integrations) {
      if (!row.enabled || row.category) continue;
      entries.push({
        kind: "integration",
        id: row._id,
        name: row.name,
        description: row.description,
        toolNames: (row.tools ?? []).map((tool) => tool.name).slice(0, 12),
      });
    }
    for (const row of skills) {
      if (!row.enabled || row.category) continue;
      entries.push({
        kind: "skill",
        id: row._id,
        name: row.name,
        description: row.description,
      });
    }
    return entries.slice(0, MAX_BATCH);
  },
});

/** Cache the model's verdicts. Anything off-list is dropped, not stored. */
export const setCategories = internalMutation({
  args: {
    verdicts: v.array(
      v.object({
        kind: v.union(v.literal("integration"), v.literal("skill")),
        id: v.string(),
        category: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const verdict of args.verdicts) {
      if (!isStoreCategory(verdict.category)) continue;
      const id =
        verdict.kind === "integration"
          ? ctx.db.normalizeId("integrations", verdict.id)
          : ctx.db.normalizeId("skills", verdict.id);
      if (!id) continue;
      const row = await ctx.db.get(id);
      if (!row) continue;
      await ctx.db.patch(row._id, {
        category: verdict.category,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

const SYSTEM_PROMPT = [
  "You sort app-store listings onto shelves.",
  `The shelves, verbatim: ${STORE_CATEGORIES.join(" | ")}.`,
  "For each numbered listing, pick the single best shelf. Use \"Everything else\" only when nothing fits.",
  'Reply with ONLY a JSON array, one object per listing: [{"n": 1, "category": "Productivity"}, ...]. No prose, no code fences.',
].join("\n");

function entryLine(entry: Entry, n: number): string {
  const bits = [`${n}. [${entry.kind}] ${entry.name}`];
  if (entry.description) bits.push(`— ${entry.description}`);
  if (entry.toolNames?.length) bits.push(`(tools: ${entry.toolNames.join(", ")})`);
  return bits.join(" ");
}

/** Dig the JSON array out of the reply, tolerating stray fences or prose. */
function parseVerdicts(text: string): { n: number; category: string }[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("No JSON array in reply.");
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("Reply is not an array.");
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { n, category } = item as { n?: unknown; category?: unknown };
    if (typeof n !== "number" || typeof category !== "string") return [];
    return [{ n, category: category.trim() }];
  });
}

/**
 * One batched classification pass. Cheap to run often: no uncategorized rows
 * means no model call at all. Failures just leave rows uncategorized for the
 * next sweep — never a user-facing error.
 */
export const categorizeStore = internalAction({
  args: {},
  handler: async (ctx) => {
    const entries: Entry[] = await ctx.runQuery(
      internal.storeCategorize.listUncategorized,
      {},
    );
    if (entries.length === 0) return null;

    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterApiKey) {
      console.warn(
        "Store categorization skipped: OPENROUTER_API_KEY is not set.",
        { pending: entries.length },
      );
      return null;
    }

    const prompt = entries
      .map((entry, index) => entryLine(entry, index + 1))
      .join("\n");

    console.log("Store categorization started.", {
      entries: entries.length,
      model: CATEGORIZE_MODEL_ID,
    });
    const openRouter = createOpenRouter({
      apiKey: openRouterApiKey,
      appName: APP_NAME,
      appUrl: siteUrl(),
    });

    const startedAt = Date.now();
    const { text, usage } = await tracedGeneration(
      // No end user behind this one — it's a cron sweeping the store — so the
      // span is attributed to "system", same as the PostHog capture below.
      {
        userId: "system",
        eventId: `store-categorize:${startedAt}`,
        eventName: "store_categorize",
        properties: {
          model: CATEGORIZE_MODEL_ID,
          entry_count: entries.length,
        },
      },
      () =>
        tracedGenerateText({
          model: openRouter.chat(CATEGORIZE_MODEL_ID),
          system: SYSTEM_PROMPT,
          prompt,
          maxOutputTokens: 3000,
          temperature: 0,
        }),
    );

    await captureAiGeneration({
      distinctId: "system",
      traceId: `store-categorize-${startedAt}`,
      model: CATEGORIZE_MODEL_ID,
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      spanName: "store_categorize",
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      outputChoices: [{ role: "assistant", content: text }],
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      latencySeconds: (Date.now() - startedAt) / 1000,
      properties: { entry_count: entries.length },
    });

    const verdicts = parseVerdicts(text).flatMap(({ n, category }) => {
      const entry = entries[n - 1];
      if (!entry || !isStoreCategory(category)) return [];
      return [{ kind: entry.kind, id: entry.id, category }];
    });
    await ctx.runMutation(internal.storeCategorize.setCategories, {
      verdicts,
    });
    console.log("Store categorization finished.", {
      entries: entries.length,
      categorized: verdicts.length,
    });
    await flushBraintrust();
    return null;
  },
});
