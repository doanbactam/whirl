import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, query } from "./_generated/server";

// How many raw search hits we consider before thread filtering, and how many
// survive into the tool result. The search index scores by BM25, so the best
// matches come first; a generous raw pool keeps good hits from being crowded
// out by rows we drop (incognito, the current thread).
const RAW_HITS = 32;
const MAX_RESULTS = 10;

// Excerpt window handed back to the model, roughly centered on the first
// matched term so the hit is visible without shipping whole transcripts.
const EXCERPT_LENGTH = 400;

/**
 * One past-conversation hit handed to the searchChatHistory tool. The BM25
 * path knows which speaker matched; the Supermemory path returns whole-turn
 * transcripts (speaker labels live inside the excerpt), so `role` is
 * optional, and `sentAt` is too — a hit without a date still beats no hit.
 */
export type ChatHistoryMatch = {
  threadTitle: string;
  role?: "user" | "assistant";
  sentAt?: number;
  excerpt: string;
};

/**
 * Cut a window out of a message body around the first occurrence of any query
 * term, so the excerpt shows WHY the message matched instead of just its
 * opening lines. Falls back to the head of the message when no term appears
 * verbatim (BM25 stems, so a match isn't always a substring).
 */
function buildExcerpt(
  content: string,
  query: string,
  length: number = EXCERPT_LENGTH,
): string {
  const haystack = content.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 1);

  let hit = -1;
  for (const term of terms) {
    const index = haystack.indexOf(term);
    if (index !== -1 && (hit === -1 || index < hit)) hit = index;
  }

  const start = Math.max(0, (hit === -1 ? 0 : hit) - length / 4);
  const end = Math.min(content.length, start + length);
  const slice = content.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${slice}${end < content.length ? "…" : ""}`;
}

/**
 * The searchChatHistory tool's backend: BM25 search over every message the
 * user has ever exchanged with whirl, hydrated with thread titles. The current
 * thread is excluded (the model already has it in context). Incognito threads
 * never surface — they're ephemeral by contract — and neither do locked ones:
 * their rows are ciphertext, so BM25 can't match them and an excerpt would be
 * base64 even if it did.
 */
export const searchMessages = internalQuery({
  args: {
    userId: v.string(),
    query: v.string(),
    excludeThreadId: v.optional(v.id("threads")),
  },
  handler: async (ctx, { userId, query, excludeThreadId }) => {
    const hits = await ctx.db
      .query("messages")
      .withSearchIndex("search_content", (q) =>
        q.search("content", query).eq("userId", userId),
      )
      .take(RAW_HITS);

    const threadCache = new Map<Id<"threads">, Doc<"threads"> | null>();
    const results: ChatHistoryMatch[] = [];

    for (const message of hits) {
      if (results.length >= MAX_RESULTS) break;
      if (message.threadId === excludeThreadId) continue;
      if (!message.content.trim()) continue;

      let thread = threadCache.get(message.threadId);
      if (thread === undefined) {
        thread = await ctx.db.get(message.threadId);
        threadCache.set(message.threadId, thread);
      }
      if (!thread || thread.incognito || thread.lock) continue;

      results.push({
        threadTitle: thread.title || "Untitled",
        role: message.role,
        sentAt: message.createdAt,
        excerpt: buildExcerpt(message.content, query),
      });
    }

    return results;
  },
});

// A Supermemory hit can point at a thread that's since been deleted (or that
// went incognito and got swept) — cap how many raw ids we'll chase before
// giving up on the stragglers.
const MAX_TITLE_LOOKUPS = 24;

/**
 * Titles for the threads a Supermemory search surfaced, keyed by the raw
 * metadata thread id. Ids that don't resolve to a live, owned, non-incognito
 * thread are simply absent — the caller drops those hits, so a deleted chat
 * never resurfaces through memory.
 */
export const resolveThreadTitles = internalQuery({
  args: {
    userId: v.string(),
    threadIds: v.array(v.string()),
  },
  handler: async (ctx, { userId, threadIds }) => {
    const titles: Record<string, string> = {};
    for (const raw of threadIds.slice(0, MAX_TITLE_LOOKUPS)) {
      if (titles[raw] !== undefined) continue;
      const threadId = ctx.db.normalizeId("threads", raw);
      if (!threadId) continue;
      const thread = await ctx.db.get(threadId);
      if (!thread) continue;
      if (thread.userId !== userId || thread.incognito || thread.lock) continue;
      titles[raw] = thread.title || "Untitled";
    }
    return titles;
  },
});

// The search modal's "Searching deeper" pass: at most this many threads come
// back, with a one-line excerpt sized for a palette row.
const DEEP_MAX_THREADS = 8;
const DEEP_EXCERPT_LENGTH = 140;

/**
 * Full-text search over the current user's message history for the search
 * modal's deep pass — the slower follow-up behind the instant title filter.
 * Same BM25 index as the searchChatHistory tool, but collapsed to one row per
 * thread (best hit wins) so results read as threads, not messages. Incognito
 * threads never surface. Signed-out callers get an empty list rather than an
 * error — the modal races auth on open.
 */
export const deepSearch = query({
  args: {
    query: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const searchQuery = args.query.trim();
    if (!searchQuery) return [];

    const hits = await ctx.db
      .query("messages")
      .withSearchIndex("search_content", (q) =>
        q.search("content", searchQuery).eq("userId", identity.subject),
      )
      .take(RAW_HITS);

    const seenThreadIds = new Set<Id<"threads">>();
    const results: Array<{ threadId: Id<"threads">; excerpt: string }> = [];

    for (const message of hits) {
      if (results.length >= DEEP_MAX_THREADS) break;
      if (seenThreadIds.has(message.threadId)) continue;
      seenThreadIds.add(message.threadId);
      if (!message.content.trim()) continue;

      const thread = await ctx.db.get(message.threadId);
      if (!thread || thread.incognito || thread.lock) continue;

      results.push({
        threadId: thread._id,
        // One-line rows: collapse whatever whitespace the message had.
        excerpt: buildExcerpt(message.content, searchQuery, DEEP_EXCERPT_LENGTH)
          .replace(/\s+/g, " ")
          .trim(),
      });
    }

    return results;
  },
});
