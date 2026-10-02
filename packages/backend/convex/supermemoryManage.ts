import { supermemoryRequest } from "./supermemory";

/**
 * The user-facing half of Supermemory: everything the Memory settings tab needs
 * to read and rewrite what Whirl remembers. `supermemory.ts` stays the
 * ingest/retrieval path the inference pipeline runs on; nothing here is ever
 * called outside an authenticated, paid-gated action (see `userMemory.ts`).
 *
 * Supermemory has shuffled its list payloads between API versions, so every
 * response is parsed defensively: an unexpected shape reads as "nothing here"
 * rather than throwing a stack trace at someone opening their settings.
 */

/** Documents come back paginated; the settings list pulls one page at a time. */
export const SOURCES_PAGE_SIZE = 8;

/** Well under the API's 10k ceiling — a memory is one fact, not an essay. */
export const MAX_MEMORY_CONTENT = 1_000;

/* Memories paginate too, and the default page is a mere 10 — ask for the
   biggest page the API takes and walk it, up to a ceiling that keeps the
   action's return under Convex's 1MB limit. Past that the card says how
   many it's showing rather than quietly truncating. */
const MEMORIES_PAGE_SIZE = 100;
const MAX_MEMORY_PAGES = 5;
const MAX_MEMORIES_RETURNED = MEMORIES_PAGE_SIZE * MAX_MEMORY_PAGES;

export type MemoryEntry = {
  id: string;
  memory: string;
  /** Static = a permanent trait ("is left-handed"), never aged out. */
  isStatic: boolean;
  createdAt: number | null;
  updatedAt: number | null;
};

export type MemorySource = {
  id: string;
  title: string;
  summary: string | null;
  /** Supermemory's ingestion stage: queued / embedding / done / failed / … */
  status: string;
  /** The Whirl thread this document was built from, when it carries one. */
  threadId: string | null;
  updatedAt: number | null;
};

export type MemorySourcePage = {
  sources: MemorySource[];
  page: number;
  totalPages: number;
  totalItems: number;
};

/* --- Response parsing ------------------------------------------------------ */

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Pull the list out of a response, whichever key it arrived under.
 *  `memoryEntries` is what /v4/memories/list actually answers with;
 *  `memories` is what the /v3 documents list confusingly calls its rows. */
function rowsOf(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  const record = asRecord(response);
  if (!record) return [];
  for (const key of [
    "memoryEntries",
    "memories",
    "results",
    "documents",
    "data",
    "items",
  ]) {
    const rows = record[key];
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

function toMemoryEntry(row: unknown): MemoryEntry | null {
  const record = asRecord(row);
  if (!record) return null;

  const id = asString(record.id) ?? asString(record.memoryId);
  const memory = asString(record.memory) ?? asString(record.content);
  if (!id || !memory) return null;

  // Forgetting is a soft delete and superseded versions stick around, so drop
  // anything already retired — the tab is about what's live right now.
  if (record.isForgotten === true || record.isLatest === false) return null;
  if (asString(record.status) === "forgotten") return null;

  const createdAt = asTimestamp(record.createdAt);
  return {
    id,
    memory,
    isStatic: record.isStatic === true,
    createdAt,
    updatedAt: asTimestamp(record.updatedAt) ?? createdAt,
  };
}

/** Our own documents are transcripts, so Supermemory usually files them under
 *  its own placeholder title rather than naming them. */
const SOURCE_TITLE_FALLBACK = "Chat memory";
const PLACEHOLDER_TITLE = "untitled document";

function toMemorySource(row: unknown): MemorySource | null {
  const record = asRecord(row);
  if (!record) return null;

  const id = asString(record.id);
  if (!id) return null;

  const rawTitle = asString(record.title);
  const title =
    rawTitle && rawTitle.toLowerCase() !== PLACEHOLDER_TITLE ? rawTitle : null;

  const metadata = asRecord(record.metadata);
  return {
    id,
    title: title ?? SOURCE_TITLE_FALLBACK,
    summary: asString(record.summary),
    status: asString(record.status) ?? "unknown",
    threadId: metadata ? asString(metadata.threadId) : null,
    updatedAt: asTimestamp(record.updatedAt) ?? asTimestamp(record.createdAt),
  };
}

/** The single memory a write echoes back — sometimes the object itself, other
 *  times wrapped in a list. Null when the shape is unfamiliar; callers refetch
 *  rather than guess. */
function firstEntryOf(response: unknown): MemoryEntry | null {
  const direct = toMemoryEntry(response);
  if (direct) return direct;
  for (const row of rowsOf(response)) {
    const entry = toMemoryEntry(row);
    if (entry) return entry;
  }
  return null;
}

function asCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

/* --- Memories -------------------------------------------------------------- */

/** Every live memory Supermemory holds for this user, newest first, with the
 *  upstream total so a capped list can say so. */
export async function listSupermemoryMemories(
  containerTag: string,
): Promise<{ memories: MemoryEntry[]; totalItems: number }> {
  const entries: MemoryEntry[] = [];
  let totalItems = 0;
  let totalPages = 1;

  for (let page = 1; page <= Math.min(totalPages, MAX_MEMORY_PAGES); page += 1) {
    const response = await supermemoryRequest<unknown>({
      path: "/v4/memories/list",
      method: "POST",
      body: {
        containerTags: [containerTag],
        limit: MEMORIES_PAGE_SIZE,
        page,
      },
    });

    for (const row of rowsOf(response)) {
      const entry = toMemoryEntry(row);
      if (entry) entries.push(entry);
    }

    const pagination = asRecord(asRecord(response)?.pagination);
    totalPages = asCount(pagination?.totalPages, page);
    totalItems = asCount(pagination?.totalItems, entries.length);
  }

  return {
    // Permanent traits first, then newest — the same order the settings list
    // shows, so they're never the ones the cap drops.
    memories: entries
      .sort((a, b) =>
        a.isStatic !== b.isStatic
          ? a.isStatic
            ? -1
            : 1
          : (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      )
      .slice(0, MAX_MEMORIES_RETURNED),
    totalItems: Math.max(totalItems, entries.length),
  };
}

/** Write a memory the user typed themselves, returning the stored row. */
export async function addSupermemoryMemory({
  containerTag,
  content,
  isStatic,
}: {
  containerTag: string;
  content: string;
  isStatic: boolean;
}): Promise<MemoryEntry | null> {
  const response = await supermemoryRequest<unknown>({
    path: "/v4/memories",
    method: "POST",
    body: {
      containerTag,
      memories: [
        {
          content: content.slice(0, MAX_MEMORY_CONTENT),
          isStatic,
          metadata: { source: "whirl", origin: "user_edit" },
        },
      ],
    },
  });
  const created = firstEntryOf(response);
  // The write echoes the row back but not always its flag; we know what we
  // asked for, so don't let the list mislabel a permanent trait.
  return created ? { ...created, isStatic } : null;
}

/** Rewrite a memory. Supermemory versions rather than overwrites — the old
 *  text is kept behind the new one, under a new id. */
export async function updateSupermemoryMemory({
  containerTag,
  id,
  content,
}: {
  containerTag: string;
  id: string;
  content: string;
}): Promise<MemoryEntry | null> {
  const response = await supermemoryRequest<unknown>({
    path: "/v4/memories",
    method: "PATCH",
    body: {
      containerTag,
      id,
      newContent: content.slice(0, MAX_MEMORY_CONTENT),
    },
  });
  return firstEntryOf(response);
}

export async function forgetSupermemoryMemory({
  containerTag,
  id,
}: {
  containerTag: string;
  id: string;
}) {
  await supermemoryRequest({
    path: "/v4/memories",
    method: "DELETE",
    body: { containerTag, id, reason: "Removed by the user in settings" },
  });
}

/* --- Source documents ------------------------------------------------------ */

/** One page of the documents Whirl has pushed for this user — the raw material
 *  memories are extracted from. */
export async function listSupermemorySources({
  containerTag,
  page,
}: {
  containerTag: string;
  page: number;
}): Promise<MemorySourcePage> {
  const safePage = Math.max(1, Math.floor(page));
  const response = await supermemoryRequest<unknown>({
    path: "/v3/documents/list",
    method: "POST",
    body: {
      containerTags: [containerTag],
      limit: SOURCES_PAGE_SIZE,
      page: safePage,
      sort: "updatedAt",
      order: "desc",
    },
  });

  const sources: MemorySource[] = [];
  for (const row of rowsOf(response)) {
    const source = toMemorySource(row);
    if (source) sources.push(source);
  }

  const pagination = asRecord(asRecord(response)?.pagination);
  return {
    sources,
    page: asCount(pagination?.currentPage, safePage),
    totalPages: asCount(pagination?.totalPages, sources.length ? safePage : 0),
    totalItems: asCount(pagination?.totalItems, sources.length),
  };
}

export async function deleteSupermemoryDocument(id: string) {
  await supermemoryRequest({
    path: `/v3/documents/${encodeURIComponent(id)}`,
    method: "DELETE",
  });
}

/** Drop the user's whole container: every document and every memory. */
export async function wipeSupermemoryContainer(
  containerTag: string,
): Promise<{ documents: number; memories: number }> {
  const response = await supermemoryRequest<unknown>({
    path: `/v3/container-tags/${encodeURIComponent(containerTag)}`,
    method: "DELETE",
  });

  const record = asRecord(response);
  return {
    documents: asCount(record?.deletedDocumentsCount, 0),
    memories: asCount(record?.deletedMemoriesCount, 0),
  };
}
