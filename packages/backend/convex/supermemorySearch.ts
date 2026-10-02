import { supermemoryRequest } from "./supermemory";

/**
 * Semantic search over the conversation transcripts Whirl stores in
 * Supermemory — the searchChatHistory tool's backend whenever memory is
 * active. Supermemory has shuffled its payloads between API versions, so
 * every response is parsed defensively: an unfamiliar shape reads as "no
 * match" rather than a thrown turn (the tool falls back to keyword search).
 *
 * Replayed against the live API 2026-08-09: POST /v3/search answers
 * `{ results: [{ documentId, title, metadata, chunks: [{ content,
 * isRelevant, score }], score, createdAt, updatedAt }] }`.
 */

const RESULT_LIMIT = 8;
const MAX_EXCERPT_CHARS = 500;

export type SupermemoryChatHit = {
  /** The Whirl thread the transcript came from, as the raw metadata string. */
  threadId: string;
  /** When the turn happened; null when the document doesn't carry a date. */
  sentAt: number | null;
  excerpt: string;
};

type SearchResult = {
  metadata?: {
    threadId?: unknown;
    createdAt?: unknown;
  };
  chunks?: unknown;
  createdAt?: unknown;
};

function chunkText(chunk: unknown): string | null {
  if (!chunk || typeof chunk !== "object") return null;
  const { content, isRelevant } = chunk as {
    content?: unknown;
    isRelevant?: unknown;
  };
  if (isRelevant === false || typeof content !== "string") return null;
  const trimmed = content.replace(/\s+/g, " ").trim();
  return trimmed || null;
}

function excerptOf(result: SearchResult): string | null {
  if (!Array.isArray(result.chunks)) return null;
  const parts: string[] = [];
  for (const chunk of result.chunks) {
    const text = chunkText(chunk);
    if (text) parts.push(text);
  }
  if (parts.length === 0) return null;
  const joined = parts.join(" … ");
  return joined.length > MAX_EXCERPT_CHARS
    ? `${joined.slice(0, MAX_EXCERPT_CHARS)}…`
    : joined;
}

function sentAtOf(result: SearchResult): number | null {
  const fromMetadata = result.metadata?.createdAt;
  if (typeof fromMetadata === "number" && Number.isFinite(fromMetadata)) {
    return fromMetadata;
  }
  if (typeof result.createdAt === "string") {
    const parsed = Date.parse(result.createdAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/**
 * The best transcript matches for a query, similarity-ordered by the API.
 * The current thread is excluded (the model already has it in context), and
 * anything without a thread id or readable excerpt is dropped — callers
 * still verify the thread ids against live threads before showing titles.
 */
export async function searchSupermemoryConversations({
  containerTag,
  query,
  excludeThreadId,
}: {
  containerTag: string;
  query: string;
  excludeThreadId?: string;
}): Promise<SupermemoryChatHit[]> {
  const response = await supermemoryRequest<{ results?: unknown }>({
    path: "/v3/search",
    method: "POST",
    body: {
      q: query,
      containerTags: [containerTag],
      limit: RESULT_LIMIT,
    },
  });

  if (!Array.isArray(response?.results)) return [];

  const hits: SupermemoryChatHit[] = [];
  const seenExcerpts = new Set<string>();
  for (const raw of response.results) {
    if (!raw || typeof raw !== "object") continue;
    const result = raw as SearchResult;

    const threadId = result.metadata?.threadId;
    if (typeof threadId !== "string" || !threadId) continue;
    if (excludeThreadId && threadId === excludeThreadId) continue;

    const excerpt = excerptOf(result);
    if (!excerpt) continue;

    // Retries re-store near-identical turns under new ids; showing the model
    // the same excerpt twice just burns its context.
    const dupeKey = `${threadId}:${excerpt.toLowerCase()}`;
    if (seenExcerpts.has(dupeKey)) continue;
    seenExcerpts.add(dupeKey);

    hits.push({ threadId, sentAt: sentAtOf(result), excerpt });
  }
  return hits;
}
