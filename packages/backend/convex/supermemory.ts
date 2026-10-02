const SUPERMEMORY_API_BASE = "https://api.supermemory.ai";

const SETTINGS_BODY = {
  shouldLLMFilter: true,
  filterPrompt:
    "Whirl is a personal AI chatbot/assistant. containerTag is the signed-in user id, so each user's memories are isolated. We store completed chat turns and historical thread transcripts. Extract durable user preferences, profile facts, ongoing projects, constraints, tastes, and useful context. Ignore one-off tasks, transient details, duplicate facts, and secrets or sensitive facts unless the user explicitly asks to remember them.",
} as const;

const MAX_QUERY_CHARS = 2_000;
const MAX_CONTEXT_ITEMS = 8;
const MAX_CONTEXT_ITEM_CHARS = 600;
const MAX_DOCUMENT_CHARS = 48_000;

let settingsConfigured = false;

export type SupermemoryPromptContext = {
  staticFacts: string[];
  dynamicFacts: string[];
  memories: string[];
};

type SupermemoryMetadata = Record<string, string | number | boolean>;

type SupermemoryProfileResponse = {
  profile?: {
    static?: unknown;
    dynamic?: unknown;
  };
  searchResults?: {
    results?: unknown;
  };
};

type SupermemorySearchResult = {
  memory?: unknown;
  chunk?: unknown;
  content?: unknown;
  document?: {
    content?: unknown;
  };
};

function supermemoryApiKey() {
  const key = process.env.SUPERMEMORY_API_KEY?.trim();
  if (!key) {
    throw new Error("Missing SUPERMEMORY_API_KEY");
  }
  return key;
}

export function isSupermemoryConfigured() {
  return Boolean(process.env.SUPERMEMORY_API_KEY?.trim());
}

export function supermemoryContainerTagForUser(userId: string) {
  return userId;
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 12)}\n[truncated]` : text;
}

function cleanText(value: unknown, max = MAX_CONTEXT_ITEM_CHARS) {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? truncate(trimmed, max) : null;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = cleanText(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_CONTEXT_ITEMS) break;
  }
  return out;
}

function memoryFromSearchResult(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const row = result as SupermemorySearchResult;
  return (
    cleanText(row.memory) ??
    cleanText(row.chunk) ??
    cleanText(row.content) ??
    cleanText(row.document?.content)
  );
}

function searchResultList(value: unknown) {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = memoryFromSearchResult(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_CONTEXT_ITEMS) break;
  }
  return out;
}

/**
 * One authenticated call to the Supermemory REST API, parsed as JSON. Throws
 * with the upstream status and a slice of its body so callers can turn a
 * failure into copy a human can act on. Shared with the management module in
 * `supermemory/manage.ts`.
 */
export async function supermemoryRequest<T>({
  path,
  method,
  body,
}: {
  path: string;
  method: "GET" | "PATCH" | "POST" | "DELETE";
  body?: Record<string, unknown>;
}): Promise<T> {
  const response = await fetch(`${SUPERMEMORY_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${supermemoryApiKey()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Supermemory ${path} failed with ${response.status}${
        detail ? `: ${detail.slice(0, 240)}` : ""
      }`,
    );
  }

  if (response.status === 204) {
    return null as T;
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function ensureSupermemorySettings() {
  if (settingsConfigured) return;
  await supermemoryRequest({
    path: "/v3/settings",
    method: "PATCH",
    body: SETTINGS_BODY,
  });
  settingsConfigured = true;
}

export async function fetchSupermemoryPromptContext({
  containerTag,
  query,
}: {
  containerTag: string;
  query: string;
}): Promise<SupermemoryPromptContext> {
  // No ensureSupermemorySettings() here: the settings body only shapes
  // ingestion filtering, and this lookup races a timeout on the hot prompt
  // path — a cold isolate can't afford the extra round trip.
  const q = query.trim();
  const response = await supermemoryRequest<SupermemoryProfileResponse>({
    path: "/v4/profile",
    method: "POST",
    body: {
      containerTag,
      ...(q ? { q: truncate(q, MAX_QUERY_CHARS) } : {}),
    },
  });

  return {
    staticFacts: stringList(response.profile?.static),
    dynamicFacts: stringList(response.profile?.dynamic),
    memories: searchResultList(response.searchResults?.results),
  };
}

export async function addSupermemoryDocument({
  containerTag,
  content,
  customId,
  metadata,
}: {
  containerTag: string;
  content: string;
  customId?: string;
  metadata?: SupermemoryMetadata;
}) {
  const trimmed = content.trim();
  if (!trimmed) return;

  await ensureSupermemorySettings();
  await supermemoryRequest({
    path: "/v3/documents",
    method: "POST",
    body: {
      content: truncate(trimmed, MAX_DOCUMENT_CHARS),
      containerTag,
      ...(customId ? { customId } : {}),
      ...(metadata ? { metadata } : {}),
    },
  });
}
