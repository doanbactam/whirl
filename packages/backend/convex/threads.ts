import { mutationGeneric, queryGeneric } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  PersistentTextStreaming,
  type StreamId,
} from "@convex-dev/persistent-text-streaming";

import { components, internal } from "./_generated/api";
import {
  createDocumentBody,
  createHtmlBody,
  deleteDocumentBody,
  deleteHtmlBody,
  hasArtifactBody,
  readDocumentBody,
  readHtmlBody,
} from "./artifactContent";
import { uniqueDocumentShortId } from "./documents";
import { deleteQueuedForThread } from "./messageQueue";
import { clearCompactionSummary } from "./threadCompaction";
import { modelKeyValidator } from "./validators";

const persistentTextStreaming = new PersistentTextStreaming(
  components.persistentTextStreaming,
);

const TITLE_FALLBACK = "New thread";
const TITLE_FALLBACK_WORDS = 5;
const TITLE_FALLBACK_MIN_CHARS = 4;

function sanitizeTitle(raw: string) {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "").trim();
  cleaned = cleaned.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");
  cleaned = cleaned.replace(/[.!?…]+$/g, "").trim();
  return cleaned;
}

function fallbackTitleFromPrompt(prompt: string) {
  const cleaned = prompt
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[`*_#[\](){}<>|~]/g, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < TITLE_FALLBACK_MIN_CHARS) {
    return TITLE_FALLBACK;
  }

  const words = cleaned.split(" ").filter(Boolean).slice(0, TITLE_FALLBACK_WORDS);
  const title = words
    .map((word) => {
      const [first = "", ...rest] = word;
      return `${first.toLocaleUpperCase()}${rest.join("").toLocaleLowerCase()}`;
    })
    .join(" ");

  return sanitizeTitle(title) || TITLE_FALLBACK;
}

async function fallbackTitleForThread(ctx: any, thread: any) {
  if (thread.title.trim()) {
    return thread.title;
  }

  // A thread always opens with the user's message, so the first few rows are
  // plenty — and this runs on every sidebar load for as long as the thread
  // stays untitled (a failed title model leaves one that way for good), so
  // reading ten full message documents to find the first is real money.
  const firstMessages = await ctx.db
    .query("messages")
    .withIndex("by_thread_created_at", (q: any) => q.eq("threadId", thread._id))
    .take(4);
  const firstUserMessage = firstMessages.find(
    (message: any) => message.role === "user",
  );
  return fallbackTitleFromPrompt(firstUserMessage?.content ?? "");
}

const RUNNING_STATUSES = new Set(["thinking", "searching", "streaming"]);

/**
 * How stale a thread can be and still plausibly have a turn in flight.
 *
 * Every path that starts one — sendUserMessage, prepareAssistantRetryFromUser,
 * resetAssistantMessage — stamps `updatedAt` on the thread first, and a Convex
 * action tops out at 10 minutes, so anything quieter than this is finished or
 * dead either way.
 *
 * This is what keeps the probe cheap. Asking every thread meant reading its
 * newest assistant message — the fattest documents we store, full reply text
 * plus phases — once per thread, per run. Now it touches only threads that
 * could actually be live.
 */
const RUNNING_PROBE_WINDOW_MS = 15 * 60 * 1000;

// True while the thread's most recent assistant turn is still in flight — used
// to spin a little indicator next to the thread in the sidebar.
async function isThreadRunning(ctx: any, threadId: string) {
  const latestAssistant = await ctx.db
    .query("messages")
    .withIndex("by_thread_role", (q: any) =>
      q.eq("threadId", threadId).eq("role", "assistant"),
    )
    .order("desc")
    .first();
  return latestAssistant != null && RUNNING_STATUSES.has(latestAssistant.status);
}

async function formatThread(ctx: any, thread: any) {
  const title = await fallbackTitleForThread(ctx, thread);
  return {
    id: thread._id,
    title,
    titleStatus: thread.titleStatus ?? "ready",
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    pinnedAt: thread.pinnedAt ?? null,
    model: thread.model ?? null,
    compactionStatus: thread.compactionStatus ?? "idle",
    compactionBoundary: thread.compactionBoundary ?? null,
    compactionUpdatedAt: thread.compactionUpdatedAt ?? null,
    compactionMarkers: thread.compactionMarkers ?? [],
    shareId: thread.shareId ?? null,
    // Whether the row wears a lock, and the sealed real title a tab holding
    // the key draws in place of the placeholder. The key envelope itself is
    // NOT here — see lockedThreads.lockFor for why.
    locked: Boolean(thread.lock),
    lockedTitle: thread.lockedTitle ?? null,
    folderId: thread.folderId ?? null,
    branchedFromThreadId: thread.branchedFromThreadId ?? null,
  };
}

// Unauthenticated public token — the only gate on /share/{shareId}. 12 chars
// over a 31-symbol alphabet ≈ 59 bits, far too large to brute-force or scrape.
const SHARE_ID_LENGTH = 12;
// Unambiguous alphabet (no 0/O/1/l/I) so share tokens are easy to read/type —
// matches the htmlArtifacts share tokens (see convex/html.ts).
const SHARE_ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

function randomShareToken(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = "";
  for (let i = 0; i < length; i += 1) {
    id += SHARE_ID_ALPHABET[bytes[i] % SHARE_ID_ALPHABET.length];
  }
  return id;
}

/** A 5-char public share token not already taken (widens on the rare clash). */
async function uniqueShareId(ctx: any): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = randomShareToken(SHARE_ID_LENGTH);
    const existing = await ctx.db
      .query("threads")
      .withIndex("by_share_id", (q: any) => q.eq("shareId", id))
      .first();
    if (!existing) return id;
  }
  return randomShareToken(SHARE_ID_LENGTH + 3);
}

/** Same, for the htmlArtifacts `shortId` space — used when forking copies vizzes. */
async function uniqueHtmlShortId(ctx: any): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = randomShareToken(SHARE_ID_LENGTH);
    const existing = await ctx.db
      .query("htmlArtifacts")
      .withIndex("by_short_id", (q: any) => q.eq("shortId", id))
      .first();
    if (!existing) return id;
  }
  return randomShareToken(SHARE_ID_LENGTH + 3);
}

async function getCurrentUserId(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Not authenticated");
  }
  return identity.subject;
}

async function getOwnedThread(ctx: any, threadId: string) {
  const userId = await getCurrentUserId(ctx);
  const thread = await ctx.db.get(threadId);

  if (!thread || thread.userId !== userId) {
    throw new Error("Thread not found");
  }

  return { thread, userId };
}

/**
 * Every thread in the sidebar. Deliberately free of anything that changes
 * mid-turn: a reactive query re-runs — and re-sends its whole result — the
 * moment any document it read is written, and this one reads the entire
 * history. The spinner beside a live thread therefore lives in
 * `runningThreadIds` below, where a phase landing costs a handful of ids
 * instead of the user's whole library, several times a second.
 */
export const listForCurrentUser = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_user_updated_at", (q: any) => q.eq("userId", userId))
      .collect();

    // Incognito threads never surface in history — they exist only to back the
    // live ephemeral session and are purged on exit / next load.
    const sorted = threads
      .filter((thread: any) => !thread.incognito)
      .sort((a: any, b: any) => b.updatedAt - a.updatedAt);
    return await Promise.all(
      sorted.map((thread: any) => formatThread(ctx, thread)),
    );
  },
});

/**
 * Which threads have a turn in flight right now — the sidebar spinners, and
 * the prefetcher's "leave this one alone for now" signal.
 *
 * Split off from the listing on purpose. This is the part that churns (every
 * phase, every status change, several times a second while a reply writes
 * itself), so it is kept as small as a query can be: only threads touched in
 * the last quarter hour are even asked, and the answer is a list of ids.
 */
export const runningThreadIds = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_user_updated_at", (q: any) => q.eq("userId", userId))
      .collect();

    const cutoff = Date.now() - RUNNING_PROBE_WINDOW_MS;
    const candidates = threads.filter(
      (thread: any) => !thread.incognito && thread.updatedAt >= cutoff,
    );
    const running = await Promise.all(
      candidates.map(async (thread: any) =>
        (await isThreadRunning(ctx, thread._id)) ? thread._id : null,
      ),
    );
    return running.filter((id: string | null): id is string => id !== null);
  },
});

export const updateThread = mutationGeneric({
  args: {
    threadId: v.id("threads"),
    title: v.string(),
  },
  handler: async (ctx, { threadId, title }) => {
    await getOwnedThread(ctx, threadId);
    const trimmed = title.trim();
    if (!trimmed) {
      throw new Error("Title cannot be empty");
    }
    await ctx.db.patch(threadId, {
      title: trimmed,
      titleStatus: "ready",
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Name the thread again, this time from everything in it.
 *
 * The first title is guessed from the opening message alone, which ages badly
 * once a chat wanders. Flipping `titleStatus` here is what lights the shimmer;
 * the scheduled action does the thinking and clears it.
 */
export const regenerateTitle = mutationGeneric({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, { threadId }) => {
    const { thread, userId } = await getOwnedThread(ctx, threadId);
    // Incognito threads are never named by a model, and never will be —
    // neither is a locked one, whose messages are ciphertext to the server.
    if (thread.incognito || thread.lock) {
      return null;
    }
    await ctx.db.patch(threadId, { titleStatus: "generating" });
    await ctx.scheduler.runAfter(0, internal.inference.regenerateThreadTitle, {
      threadId,
      userId,
    });
    return null;
  },
});

export const setPinned = mutationGeneric({
  args: {
    threadId: v.id("threads"),
    pinned: v.boolean(),
  },
  handler: async (ctx, { threadId, pinned }) => {
    await getOwnedThread(ctx, threadId);
    await ctx.db.patch(threadId, {
      pinnedAt: pinned ? Date.now() : undefined,
    });
    return null;
  },
});

/** Moves a thread into a folder (or out of any folder with `folderId: null`). */
export const setFolder = mutationGeneric({
  args: {
    threadId: v.id("threads"),
    folderId: v.union(v.id("folders"), v.null()),
  },
  handler: async (ctx, { threadId, folderId }) => {
    const { userId } = await getOwnedThread(ctx, threadId);
    if (folderId) {
      const folder = await ctx.db.get(folderId);
      if (!folder || folder.userId !== userId) {
        throw new Error("Folder not found");
      }
    }
    await ctx.db.patch(threadId, { folderId: folderId ?? undefined });
    return null;
  },
});

export const setModel = mutationGeneric({
  args: {
    threadId: v.id("threads"),
    model: modelKeyValidator,
  },
  handler: async (ctx, { threadId, model }) => {
    await getOwnedThread(ctx, threadId);
    await ctx.db.patch(threadId, { model });
    return null;
  },
});

export const deleteThread = mutationGeneric({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, { threadId }) => {
    await getOwnedThread(ctx, threadId);

    const [messages, docs, html] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_thread_created_at", (q: any) =>
          q.eq("threadId", threadId),
        )
        .collect(),
      ctx.db
        .query("documents")
        .withIndex("by_thread", (q: any) => q.eq("threadId", threadId))
        .collect(),
      ctx.db
        .query("htmlArtifacts")
        .withIndex("by_thread", (q: any) => q.eq("threadId", threadId))
        .collect(),
    ]);

    await Promise.all(messages.map((message: any) => ctx.db.delete(message._id)));

    /* The thread's artifacts go too. They were being left behind — orphan rows
       no message referenced, invisible and unreachable — and now that bodies
       live in their own rows there'd be a second orphan for each. Nothing
       shares them: fork and branch deep-copy artifacts into new rows, unlike
       attachment blobs, which are shared by storageId and so are deliberately
       left alone here. */
    await Promise.all(
      docs.map(async (doc: any) => {
        await deleteDocumentBody(ctx, doc);
        await ctx.db.delete(doc._id);
      }),
    );
    await Promise.all(
      html.map(async (row: any) => {
        await deleteHtmlBody(ctx, row);
        await ctx.db.delete(row._id);
      }),
    );
    await clearCompactionSummary(ctx, threadId);
    await deleteQueuedForThread(ctx, threadId);
    await ctx.db.delete(threadId);

    return null;
  },
});

/**
 * Hard-delete one thread and everything hanging off it: its messages (plus any
 * uploaded attachment blobs and persisted stream chunks), the documents and
 * HTML artifacts whirl authored in it, and finally the thread row itself. Used
 * to scrub incognito threads so nothing survives the session.
 */
async function purgeThreadCompletely(ctx: any, threadId: string) {
  const [messages, docs, html] = await Promise.all([
    ctx.db
      .query("messages")
      .withIndex("by_thread_created_at", (q: any) => q.eq("threadId", threadId))
      .collect(),
    ctx.db
      .query("documents")
      .withIndex("by_thread", (q: any) => q.eq("threadId", threadId))
      .collect(),
    ctx.db
      .query("htmlArtifacts")
      .withIndex("by_thread", (q: any) => q.eq("threadId", threadId))
      .collect(),
  ]);

  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.storageId) {
        try {
          await ctx.storage.delete(attachment.storageId);
        } catch {
          // The blob may already be gone — never let a stale id block the purge.
        }
      }
    }
    if (message.streamId) {
      try {
        await persistentTextStreaming.deleteStream(
          ctx,
          message.streamId as StreamId,
        );
      } catch {
        // Stream chunks are best-effort to clear; keep purging regardless.
      }
    }
    await ctx.db.delete(message._id);
  }

  // Bodies live in their own rows now, so they have to be taken out by hand —
  // nothing else references them, so a missed one would leak forever.
  await Promise.all(
    docs.map(async (doc: any) => {
      await deleteDocumentBody(ctx, doc);
      await ctx.db.delete(doc._id);
    }),
  );
  await Promise.all(
    html.map(async (row: any) => {
      await deleteHtmlBody(ctx, row);
      await ctx.db.delete(row._id);
    }),
  );
  // This helper takes the id loosely (the file is queryGeneric-based), so the
  // cast is just re-stating what the caller already guaranteed.
  await clearCompactionSummary(ctx, threadId as any);
  await deleteQueuedForThread(ctx, threadId as any);
  await ctx.db.delete(threadId);
}

/**
 * Scrub incognito threads for the current user. With a `threadId`, purges just
 * that one (only if it's the user's own incognito thread — otherwise a no-op,
 * so this can never touch a real conversation). Without one, purges every
 * incognito thread the user has, which is how a fresh load / re-entry guarantees
 * no ephemeral chat ever lingers.
 */
export const purgeIncognito = mutationGeneric({
  args: {
    threadId: v.optional(v.id("threads")),
  },
  handler: async (ctx, { threadId }) => {
    const userId = await getCurrentUserId(ctx);

    let targets: any[];
    if (threadId) {
      const thread = await ctx.db.get(threadId);
      targets =
        thread && thread.userId === userId && thread.incognito ? [thread] : [];
    } else {
      targets = await ctx.db
        .query("threads")
        .withIndex("by_user_incognito", (q: any) =>
          q.eq("userId", userId).eq("incognito", true),
        )
        .collect();
    }

    for (const thread of targets) {
      await purgeThreadCompletely(ctx, thread._id);
    }

    return { purged: targets.length };
  },
});

/**
 * Mint (or return the existing) public share token for a thread the user owns.
 * Idempotent: sharing an already-shared thread just hands back the same token,
 * so the link is stable and "share" never creates duplicates. The token is the
 * gate — see {@link getSharedThread}, which reads the thread unauthenticated.
 */
export const shareThread = mutationGeneric({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, { threadId }) => {
    const { thread } = await getOwnedThread(ctx, threadId);
    // A public link would hand out the conversation the lock exists to keep
    // in one pair of hands — and a viewer has no key to render it with anyway.
    if (thread.lock) {
      throw new ConvexError("You cannot share a locked chat.");
    }

    /* Every completed artifact gets its own public token alongside the
       thread's, so the shared page and the markdown transcript can hand
       out working /doc and /visual links. Runs on re-share too —
       artifacts born after the first share still get theirs. */
    const [docs, html] = await Promise.all([
      ctx.db
        .query("documents")
        .withIndex("by_thread", (q: any) => q.eq("threadId", threadId))
        .collect(),
      ctx.db
        .query("htmlArtifacts")
        .withIndex("by_thread", (q: any) => q.eq("threadId", threadId))
        .collect(),
    ]);
    for (const doc of docs) {
      if (!doc.shortId && hasArtifactBody(doc)) {
        await ctx.db.patch(doc._id, {
          shortId: await uniqueDocumentShortId(ctx as any),
        });
      }
    }
    for (const artifact of html) {
      /* An artifact that reads live integration data has no public page —
         getSharedArtifact refuses to serve it — so minting a token for one
         would only ever produce a link that says "not available". */
      if ((artifact.bindings?.length ?? 0) > 0) continue;
      if (!artifact.shortId && artifact.status === "complete") {
        await ctx.db.patch(artifact._id, {
          shortId: await uniqueHtmlShortId(ctx),
        });
      }
    }

    if (thread.shareId) {
      return { shareId: thread.shareId };
    }
    const shareId = await uniqueShareId(ctx);
    await ctx.db.patch(threadId, { shareId });
    return { shareId };
  },
});

/**
 * Revoke a thread's public share link. The token is cleared so the shared page
 * 404s; sharing again later mints a fresh token.
 */
export const unshareThread = mutationGeneric({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, { threadId }) => {
    await getOwnedThread(ctx, threadId);
    await ctx.db.patch(threadId, { shareId: undefined });
    return null;
  },
});

/**
 * Remap a source message's document/HTML phases onto the freshly-copied
 * artifacts for a fork — same shape the live chat renders, pointing at the new
 * owned rows. Every other phase kind (reasoning, search, tools, weather) is
 * dropped, mirroring exactly what a public share exposes.
 */
function forkArtifactPhases(
  phases: any[] | undefined,
  docIdMap: Map<string, any>,
  htmlIdMap: Map<string, any>,
) {
  if (!phases?.length) return [];
  const out: any[] = [];
  for (const phase of phases) {
    if (phase.kind === "document" && phase.documentId && phase.ok !== false) {
      const mapped = docIdMap.get(phase.documentId as string);
      if (!mapped) continue;
      out.push({
        kind: "document",
        op: phase.op === "edit" ? "edit" : "create",
        documentId: mapped,
        ...(phase.title ? { title: phase.title } : {}),
        ...(typeof phase.editCount === "number"
          ? { editCount: phase.editCount }
          : {}),
        ok: true,
        pending: false,
        ...(typeof phase.contentOffset === "number"
          ? { contentOffset: phase.contentOffset }
          : {}),
      });
    } else if (phase.kind === "html" && phase.htmlId && phase.ok !== false) {
      const mapped = htmlIdMap.get(phase.htmlId as string);
      if (!mapped) continue;
      out.push({
        kind: "html",
        op: phase.op === "edit" ? "edit" : "create",
        ...(phase.mode ? { mode: phase.mode } : {}),
        htmlId: mapped,
        ...(phase.title ? { title: phase.title } : {}),
        ...(typeof phase.editCount === "number"
          ? { editCount: phase.editCount }
          : {}),
        ok: true,
        pending: false,
        ...(typeof phase.contentOffset === "number"
          ? { contentOffset: phase.contentOffset }
          : {}),
      });
    }
  }
  return out;
}

/**
 * Copy a public shared thread into a fresh thread the current user owns, so a
 * visitor can keep the conversation going ("fork this chat"). Mirrors exactly
 * what the share exposes: message text + the documents and visualizations whirl
 * authored — deep-copied into new owned rows, with phase references remapped and
 * fresh public tokens minted. Reasoning, search sources, tool calls, attachments
 * and stream state are all dropped. Returns the new thread id; the caller seeds
 * it with the visitor's first message.
 */
export const forkSharedThread = mutationGeneric({
  args: {
    shareId: v.string(),
  },
  handler: async (ctx, { shareId }) => {
    const userId = await getCurrentUserId(ctx);

    const source = await ctx.db
      .query("threads")
      .withIndex("by_share_id", (q: any) => q.eq("shareId", shareId))
      .first();
    if (!source) {
      throw new Error("This shared conversation isn't available.");
    }

    const now = Date.now();
    const [messages, docs, html] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_thread_created_at", (q: any) =>
          q.eq("threadId", source._id),
        )
        .collect(),
      ctx.db
        .query("documents")
        .withIndex("by_thread", (q: any) => q.eq("threadId", source._id))
        .collect(),
      ctx.db
        .query("htmlArtifacts")
        .withIndex("by_thread", (q: any) => q.eq("threadId", source._id))
        .collect(),
    ]);

    const newThreadId = await ctx.db.insert("threads", {
      userId,
      title: source.title?.trim() || "Shared conversation",
      titleStatus: "ready",
      createdAt: now,
      updatedAt: now,
      model: source.model ?? "Auto",
    });

    // Deep-copy the artifacts into new owned rows so the forked thread's cards
    // read live rows the user actually owns; remember the id remap for phases.
    const docIdMap = new Map<string, any>();
    for (const doc of docs) {
      if (!hasArtifactBody(doc)) continue;
      const body = await readDocumentBody(ctx, doc);
      if (!body.trim()) continue;
      const id = await ctx.db.insert("documents", {
        threadId: newThreadId,
        userId,
        title: doc.title,
        contentId: await createDocumentBody(ctx, body),
        hasContent: true,
        format: doc.format ?? "markdown",
        ...(doc.fileName ? { fileName: doc.fileName } : {}),
        ...(doc.language ? { language: doc.language } : {}),
        status: "complete",
        shortId: await uniqueDocumentShortId(ctx as any),
        updatedAt: now,
      });
      docIdMap.set(doc._id as string, id);
    }

    const htmlIdMap = new Map<string, any>();
    for (const viz of html) {
      if (viz.status !== "complete" || !hasArtifactBody(viz)) continue;
      const body = await readHtmlBody(ctx, viz);
      if (!body) continue;
      const id = await ctx.db.insert("htmlArtifacts", {
        threadId: newThreadId,
        userId,
        kind: viz.kind,
        title: viz.title,
        contentId: await createHtmlBody(ctx, body),
        hasContent: true,
        status: "complete",
        shortId: await uniqueHtmlShortId(ctx),
        updatedAt: now,
      });
      htmlIdMap.set(viz._id as string, id);
    }

    // Copy the conversation, mirroring the share view: message text + the
    // (remapped) document/HTML phases only. Original timestamps are kept so the
    // history stays ordered and the visitor's seeded message lands after it.
    let copied = 0;
    for (const message of messages) {
      if (message.role === "assistant" && message.status === "error") continue;
      const phases = forkArtifactPhases(message.phases, docIdMap, htmlIdMap);
      const hasText = Boolean(message.content && message.content.trim());
      if (!hasText && phases.length === 0) continue;
      await ctx.db.insert("messages", {
        threadId: newThreadId,
        userId,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        updatedAt: now,
        ...(message.role === "assistant"
          ? { status: "complete" as const, phases }
          : {}),
      });
      copied += 1;
    }

    return { threadId: newThreadId, messageCount: copied };
  },
});

/**
 * Remap a source message's phases for a branch. Unlike a share fork, a branch
 * stays inside the owner's account, so every phase kind survives (reasoning,
 * sources, tool calls, weather, images) — only document/HTML phases need their
 * ids pointed at the freshly-copied artifact rows. Doc/html phases whose target
 * didn't copy (failed or empty artifacts) are dropped rather than left pointing
 * across threads, and pending phases from an interrupted run have nothing to
 * show, so they're dropped too.
 */
function branchArtifactPhases(
  phases: any[] | undefined,
  docIdMap: Map<string, any>,
  htmlIdMap: Map<string, any>,
) {
  if (!phases?.length) return [];
  const out: any[] = [];
  for (const phase of phases) {
    if (phase.pending) continue;
    if (phase.kind === "document") {
      const mapped = phase.documentId
        ? docIdMap.get(phase.documentId as string)
        : undefined;
      if (!mapped) continue;
      out.push({ ...phase, documentId: mapped });
    } else if (phase.kind === "html") {
      const mapped = phase.htmlId
        ? htmlIdMap.get(phase.htmlId as string)
        : undefined;
      if (!mapped) continue;
      out.push({ ...phase, htmlId: mapped });
    } else {
      out.push(phase);
    }
  }
  return out;
}

/**
 * Branch the conversation into a brand-new thread at a checkpoint message: the
 * history up to and including that message is copied, everything after it stays
 * behind. The copy keeps what the owner already sees — attachments, mention
 * chips, phases (with document/HTML artifacts deep-copied and remapped) and
 * per-message model settings — but drops stream state and billing so nothing
 * double-counts. Returns the new thread id; the client navigates straight to it.
 */
export const branchThread = mutationGeneric({
  args: {
    threadId: v.id("threads"),
    messageId: v.id("messages"),
  },
  handler: async (ctx, { threadId, messageId }) => {
    const { thread, userId } = await getOwnedThread(ctx, threadId);
    // An incognito chat is a promise that nothing outlives the session —
    // branching it into a persistent thread would quietly break that.
    if (thread.incognito) {
      throw new Error("Incognito chats can't be branched.");
    }
    // The copy would land in a thread with no lock of its own, in the clear.
    if (thread.lock) {
      throw new ConvexError("You cannot branch a locked chat.");
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_created_at", (q: any) => q.eq("threadId", threadId))
      .collect();
    const checkpointIndex = messages.findIndex(
      (message: any) => message._id === messageId,
    );
    if (checkpointIndex === -1) {
      throw new Error("Message not found");
    }
    const source = messages.slice(0, checkpointIndex + 1);

    const now = Date.now();
    const newThreadId = await ctx.db.insert("threads", {
      userId,
      title: thread.title?.trim() || "New thread",
      titleStatus: "ready",
      createdAt: now,
      updatedAt: now,
      model: thread.model ?? "Auto",
      branchedFromThreadId: threadId,
    });

    // Only artifacts the copied turns actually reference come along — a doc
    // authored after the checkpoint belongs to the future the branch left off.
    const referencedDocIds = new Set<string>();
    const referencedHtmlIds = new Set<string>();
    for (const message of source) {
      for (const phase of message.phases ?? []) {
        if (phase.kind === "document" && phase.documentId) {
          referencedDocIds.add(phase.documentId as string);
        } else if (phase.kind === "html" && phase.htmlId) {
          referencedHtmlIds.add(phase.htmlId as string);
        }
      }
    }

    const docIdMap = new Map<string, any>();
    for (const docId of referencedDocIds) {
      const doc = await ctx.db.get(docId as any);
      if (!doc || doc.threadId !== threadId) continue;
      if (!hasArtifactBody(doc)) continue;
      const body = await readDocumentBody(ctx, doc);
      if (!body.trim()) continue;
      const id = await ctx.db.insert("documents", {
        threadId: newThreadId,
        userId,
        title: doc.title,
        contentId: await createDocumentBody(ctx, body),
        hasContent: true,
        format: doc.format ?? "markdown",
        ...(doc.fileName ? { fileName: doc.fileName } : {}),
        ...(doc.language ? { language: doc.language } : {}),
        status: "complete",
        shortId: await uniqueDocumentShortId(ctx as any),
        updatedAt: now,
      });
      docIdMap.set(docId, id);
    }

    const htmlIdMap = new Map<string, any>();
    for (const htmlId of referencedHtmlIds) {
      const viz = await ctx.db.get(htmlId as any);
      if (!viz || viz.threadId !== threadId) continue;
      if (viz.status !== "complete" || !hasArtifactBody(viz)) continue;
      const body = await readHtmlBody(ctx, viz);
      if (!body) continue;
      const id = await ctx.db.insert("htmlArtifacts", {
        threadId: newThreadId,
        userId,
        kind: viz.kind,
        title: viz.title,
        contentId: await createHtmlBody(ctx, body),
        hasContent: true,
        status: "complete",
        shortId: await uniqueHtmlShortId(ctx),
        updatedAt: now,
      });
      htmlIdMap.set(htmlId, id);
    }

    // Copy the conversation. Original createdAt is kept so ordering holds and
    // fresh sends land after the copied history. Attachments ride along by
    // reference (regular thread deletion never touches blobs, so sharing a
    // storageId across threads is safe). Stream ids, usage costs and legacy
    // memory pointers stay behind — the branch never re-bills or re-streams.
    let copied = 0;
    for (const message of source) {
      if (message.role === "assistant" && message.status === "error") continue;
      const phases = branchArtifactPhases(message.phases, docIdMap, htmlIdMap);
      const hasText = Boolean(message.content && message.content.trim());
      const hasAttachments = (message.attachments?.length ?? 0) > 0;
      if (!hasText && phases.length === 0 && !hasAttachments) continue;
      await ctx.db.insert("messages", {
        threadId: newThreadId,
        userId,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        updatedAt: now,
        ...(hasAttachments ? { attachments: message.attachments } : {}),
        ...(message.integrations ? { integrations: message.integrations } : {}),
        ...(message.skills ? { skills: message.skills } : {}),
        ...(message.role === "assistant"
          ? {
              // A stopped reply stays visibly cut short; everything else copied
              // is settled history, so it lands as complete.
              status:
                message.status === "stopped"
                  ? ("stopped" as const)
                  : ("complete" as const),
              phases,
              ...(message.model ? { model: message.model } : {}),
              ...(message.thinking !== undefined
                ? { thinking: message.thinking }
                : {}),
              ...(message.search !== undefined
                ? { search: message.search }
                : {}),
              ...(typeof message.outputTokens === "number"
                ? { outputTokens: message.outputTokens }
                : {}),
              ...(typeof message.durationMs === "number"
                ? { durationMs: message.durationMs }
                : {}),
            }
          : {}),
      });
      copied += 1;
    }

    return { threadId: newThreadId, messageCount: copied };
  },
});

/**
 * Roll the thread back to a checkpoint message: every message after it is
 * deleted, along with the documents/visualizations those deleted turns authored
 * and their persisted stream chunks. Attachment blobs are left alone (branches
 * may share them, and regular thread deletion never scrubs blobs either).
 * Compaction bookkeeping that pointed past the checkpoint is unwound so no
 * marker or boundary dangles at a deleted message.
 */
export const rollbackToMessage = mutationGeneric({
  args: {
    threadId: v.id("threads"),
    messageId: v.id("messages"),
  },
  handler: async (ctx, { threadId, messageId }) => {
    const { thread } = await getOwnedThread(ctx, threadId);

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_created_at", (q: any) => q.eq("threadId", threadId))
      .collect();
    const checkpointIndex = messages.findIndex(
      (message: any) => message._id === messageId,
    );
    if (checkpointIndex === -1) {
      throw new Error("Message not found");
    }
    const doomed = messages.slice(checkpointIndex + 1);
    if (doomed.length === 0) {
      return { deleted: 0 };
    }

    const doomedIds = new Set(doomed.map((message: any) => message._id as string));
    for (const message of doomed) {
      if (message.streamId) {
        try {
          await persistentTextStreaming.deleteStream(
            ctx,
            message.streamId as StreamId,
          );
        } catch {
          // Stream chunks are best-effort to clear; keep deleting regardless.
        }
      }
      await ctx.db.delete(message._id);
    }

    // Artifacts authored by the deleted turns go with them — otherwise the
    // toolbar's artifact menu would list documents no message references.
    const [docs, html] = await Promise.all([
      ctx.db
        .query("documents")
        .withIndex("by_thread", (q: any) => q.eq("threadId", threadId))
        .collect(),
      ctx.db
        .query("htmlArtifacts")
        .withIndex("by_thread", (q: any) => q.eq("threadId", threadId))
        .collect(),
    ]);
    await Promise.all(
      docs
        .filter(
          (doc: any) =>
            doc.createdByMessageId &&
            doomedIds.has(doc.createdByMessageId as string),
        )
        .map(async (doc: any) => {
          await deleteDocumentBody(ctx, doc);
          await ctx.db.delete(doc._id);
        }),
    );
    await Promise.all(
      html
        .filter(
          (row: any) =>
            row.createdByMessageId &&
            doomedIds.has(row.createdByMessageId as string),
        )
        .map(async (row: any) => {
          await deleteHtmlBody(ctx, row);
          await ctx.db.delete(row._id);
        }),
    );

    const markers = (thread.compactionMarkers ?? []).filter(
      (marker: any) => !doomedIds.has(marker.messageId as string),
    );
    const boundaryDeleted = Boolean(
      thread.compactionBoundary &&
        doomedIds.has(thread.compactionBoundary as string),
    );
    await ctx.db.patch(threadId, {
      updatedAt: Date.now(),
      ...(thread.compactionMarkers &&
      markers.length !== thread.compactionMarkers.length
        ? { compactionMarkers: markers }
        : {}),
      // The summary condensed history up to a boundary that no longer exists —
      // drop it so inference goes back to reading the real messages. It lives
      // in its own row now, so the legacy field is cleared alongside.
      ...(boundaryDeleted
        ? {
            compactionBoundary: undefined,
            compactionSummary: undefined,
            compactionStatus: "idle" as const,
          }
        : {}),
    });
    if (boundaryDeleted) await clearCompactionSummary(ctx, threadId);

    return { deleted: doomed.length };
  },
});

/**
 * Everything whirl authored in a thread — its documents and visualizations —
 * for the thread toolbar's artifact menu. Auth-scoped: a user only ever sees
 * their own thread's artifacts. Attachments live on the messages themselves, so
 * the client collects those from the loaded message list rather than here.
 */
export const getThreadArtifacts = queryGeneric({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, { threadId }) => {
    const userId = await getCurrentUserId(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== userId) {
      return { documents: [], visualizations: [] };
    }

    const [docs, html] = await Promise.all([
      ctx.db
        .query("documents")
        .withIndex("by_thread", (q: any) => q.eq("threadId", threadId))
        .collect(),
      ctx.db
        .query("htmlArtifacts")
        .withIndex("by_thread", (q: any) => q.eq("threadId", threadId))
        .collect(),
    ]);

    /* Note what ISN'T here: a single body. Both rows now carry `hasContent`
       and keep their text in a side table, so listing a thread's artifacts
       costs the metadata and nothing else — and a streaming body no longer
       invalidates this query at all. */
    const documents = docs
      .filter((d: any) => hasArtifactBody(d))
      .sort((a: any, b: any) => a.updatedAt - b.updatedAt)
      .map((d: any) => ({
        id: d._id as string,
        title: d.title?.trim() || "Untitled document",
        format: (d.format ?? "markdown") as "markdown" | "code",
        fileName: (d.fileName ?? null) as string | null,
        language: (d.language ?? null) as string | null,
        updatedAt: d.updatedAt as number,
      }));

    const visualizations = html
      .filter((h: any) => h.status === "complete" && hasArtifactBody(h))
      .sort((a: any, b: any) => a.updatedAt - b.updatedAt)
      .map((h: any) => ({
        id: h._id as string,
        title: h.title?.trim() || "Visualization",
        kind: h.kind as "inline" | "full",
        shortId: (h.shortId ?? null) as string | null,
        updatedAt: h.updatedAt as number,
      }));

    return { documents, visualizations };
  },
});

// Phases the public share page is allowed to surface: only the artifact cards
// (documents + visualizations). Reasoning text, search sources, MCP/tool names
// and weather are deliberately stripped so a shared link never leaks them.
function publicArtifactPhases(phases: any[] | undefined) {
  if (!phases?.length) return [];
  const out: Array<{
    kind: "document" | "html";
    refId: string;
    op: "create" | "edit";
    editCount: number | null;
    contentOffset: number | null;
  }> = [];
  for (const phase of phases) {
    const isDoc = phase.kind === "document" && phase.documentId;
    const isHtml = phase.kind === "html" && phase.htmlId;
    if ((isDoc || isHtml) && phase.ok !== false) {
      out.push({
        kind: phase.kind,
        refId: (isDoc ? phase.documentId : phase.htmlId) as string,
        // Carry the op so a revision renders as a compact "Updated" card in the
        // chat UI — exactly like a live thread — rather than re-rendering the
        // whole artifact a second time.
        op: phase.op === "edit" ? "edit" : "create",
        editCount:
          typeof phase.editCount === "number" ? phase.editCount : null,
        contentOffset:
          typeof phase.contentOffset === "number" ? phase.contentOffset : null,
      });
    }
  }
  return out;
}

/**
 * Public, UNAUTHENTICATED read of a shared thread by its token — powers
 * {site}/share/{shareId}. The token is the gate: anyone with the link sees a
 * live, read-only view of the conversation (it tracks the real thread). Returns
 * a deliberately trimmed payload — message text + the documents/visualizations
 * whirl authored — and never attachments, reasoning, sources, or tool details.
 */
export const getSharedThread = queryGeneric({
  args: {
    shareId: v.string(),
  },
  handler: async (ctx, { shareId }) => {
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_share_id", (q: any) => q.eq("shareId", shareId))
      .first();
    if (!thread) return null;

    const [rawMessages, docs, html] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_thread_created_at", (q: any) =>
          q.eq("threadId", thread._id),
        )
        .collect(),
      ctx.db
        .query("documents")
        .withIndex("by_thread", (q: any) => q.eq("threadId", thread._id))
        .collect(),
      ctx.db
        .query("htmlArtifacts")
        .withIndex("by_thread", (q: any) => q.eq("threadId", thread._id))
        .collect(),
    ]);

    const documents: Record<
      string,
      {
        title: string;
        content: string;
        format: "markdown" | "code";
        fileName: string | null;
        language: string | null;
        shortId: string | null;
      }
    > = {};
    for (const d of docs) {
      if (!hasArtifactBody(d)) continue;
      const content = await readDocumentBody(ctx, d);
      if (!content.trim()) continue;
      documents[d._id as string] = {
        title: d.title?.trim() || "Untitled document",
        content,
        format: d.format ?? "markdown",
        fileName: d.fileName ?? null,
        language: d.language ?? null,
        // The public /doc/{shortId} token — minted by shareThread, so the
        // transcript can link the file directly.
        shortId: (d.shortId ?? null) as string | null,
      };
    }

    const visualizations: Record<
      string,
      {
        title: string;
        content: string;
        kind: "inline" | "full";
        runtime: "html" | "react";
        shortId: string | null;
        dataLocked: boolean;
      }
    > = {};
    for (const h of html) {
      if (h.status !== "complete" || !hasArtifactBody(h)) continue;
      /* An artifact built around the owner's live integration data is
         withheld from a shared transcript exactly like it is from its own
         share link: it renders as a locked card, with no body attached. The
         data could never load for a visitor anyway — but the module that
         frames it is theirs too, and this page is public. */
      if ((h.bindings?.length ?? 0) > 0) {
        visualizations[h._id as string] = {
          title: h.title?.trim() || "Visualization",
          content: "",
          kind: h.kind,
          runtime: h.runtime ?? "html",
          shortId: null,
          dataLocked: true,
        };
        continue;
      }
      const content = await readHtmlBody(ctx, h);
      if (!content) continue;
      visualizations[h._id as string] = {
        title: h.title?.trim() || "Visualization",
        content,
        kind: h.kind,
        runtime: h.runtime ?? "html",
        // The public /visual/{shortId} token, so the panel can offer a real
        // shareable link and "open in new tab" — that page is public too.
        shortId: (h.shortId ?? null) as string | null,
        dataLocked: false,
      };
    }

    /* Whirl-generated pictures ride two ways: the paint tool's image
       phase (already absolute public storage URLs) and the Image tier's
       assistant attachments (hydrated here). User attachments stay
       private — only assistant rows are read. */
    const generatedImageUrls = async (m: any): Promise<string[]> => {
      if (m.role !== "assistant") return [];
      const urls: string[] = [];
      for (const phase of m.phases ?? []) {
        if (phase.kind === "image" && phase.ok !== false) {
          for (const url of phase.images ?? []) urls.push(url);
        }
      }
      for (const attachment of m.attachments ?? []) {
        if (!attachment.type?.startsWith("image/")) continue;
        const url = attachment.storageId
          ? await ctx.storage.getUrl(attachment.storageId)
          : (attachment.url ?? null);
        if (url) urls.push(url);
      }
      return urls;
    };

    const messages: Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
      createdAt: number;
      artifacts: ReturnType<typeof publicArtifactPhases>;
      images: string[];
    }> = [];
    for (const m of rawMessages) {
      // Drop error turns (gate/overload sentinels) and empty placeholders.
      if (m.role === "assistant" && m.status === "error") continue;
      // Only artifacts whose row actually resolved to shareable content.
      const artifacts = publicArtifactPhases(m.phases).filter((p) =>
        p.kind === "document"
          ? documents[p.refId] !== undefined
          : visualizations[p.refId] !== undefined,
      );
      const images = await generatedImageUrls(m);
      const hasText = Boolean(m.content && m.content.trim());
      if (!hasText && artifacts.length === 0 && images.length === 0) continue;
      messages.push({
        id: m._id as string,
        role: m.role as "user" | "assistant",
        content: m.content as string,
        createdAt: m.createdAt as number,
        artifacts,
        images,
      });
    }

    return {
      title: thread.title?.trim() || "Shared conversation",
      messages,
      documents,
      visualizations,
    };
  },
});
