import { mutationGeneric, queryGeneric } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  PersistentTextStreaming,
  StreamIdValidator,
  type StreamId,
} from "@convex-dev/persistent-text-streaming";

import { components, internal } from "./_generated/api";
import { drainQueuedMessages } from "./messageQueue";
import { resolveSendModel } from "./models";
import {
  appendUserTurn,
  displayNameFromIdentity,
  scheduleAssistantTurn as scheduleTurn,
  verifyMentions,
} from "./turns";
import {
  attachmentValidator,
  integrationMentionValidator,
  messageStatusValidator,
  phaseValidator,
  questionAnswerValidator,
  sendOptionsValidator,
  skillMentionValidator,
} from "./validators";

const TITLE_INPUT_MAX_CHARS = 250;
const TITLE_FALLBACK = "New thread";
const TITLE_FALLBACK_WORDS = 5;
const TITLE_FALLBACK_MIN_CHARS = 4;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_MESSAGES = 20;

const persistentTextStreaming = new PersistentTextStreaming(
  components.persistentTextStreaming,
);

function titlePromptInput(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.slice(0, TITLE_INPUT_MAX_CHARS);
}

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

type MessageHydrationCache = {
  documents: Map<string, Promise<any>>;
  storageUrls: Map<string, Promise<string | null>>;
};

function createMessageHydrationCache(): MessageHydrationCache {
  return {
    documents: new Map(),
    storageUrls: new Map(),
  };
}

function getCachedDocument(
  ctx: any,
  cache: MessageHydrationCache,
  id: string,
) {
  const pending = cache.documents.get(id);
  if (pending) return pending;

  const created = Promise.resolve(ctx.db.get(id));
  cache.documents.set(id, created);
  return created;
}

function getCachedStorageUrl(
  ctx: any,
  cache: MessageHydrationCache,
  id: string,
) {
  const pending = cache.storageUrls.get(id);
  if (pending) return pending;

  const created = Promise.resolve(ctx.storage.getUrl(id)) as Promise<
    string | null
  >;
  cache.storageUrls.set(id, created);
  return created;
}

async function formatMessage(
  ctx: any,
  message: any,
  cache: MessageHydrationCache,
) {
  return {
    id: message._id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    attachments: await hydrateAttachmentUrls(
      ctx,
      cache,
      message.attachments,
    ),
    integrations: await hydrateIntegrationMentions(
      ctx,
      cache,
      message.integrations,
    ),
    skills: await hydrateSkillMentions(ctx, cache, message.skills),
    // The body is ciphertext; the client opens it with the thread's key.
    sealed: message.sealed === true,
    status: message.status,
    phases: message.phases,
    streamId: message.streamId,
    model: message.model,
    thinking: message.thinking,
    search: message.search,
    addedMemoryIds: message.addedMemoryIds,
    outputTokens: message.outputTokens,
    durationMs: message.durationMs,
    usageCost: message.usageCost,
  };
}

async function hydrateAttachmentUrls(
  ctx: any,
  cache: MessageHydrationCache,
  attachments: any[] | undefined,
) {
  if (!attachments) {
    return attachments;
  }

  return await Promise.all(
    attachments.map(async ({ text: _text, ...attachment }) => {
      // `text` is the extracted body of the file — a whole PDF or spreadsheet
      // read into markdown. It is model context and nothing on screen has ever
      // rendered it, but it rode down with every one of these results: a
      // transcript re-sends in full on every phase a reply lands, several
      // times a second, so one attached document could be worth megabytes a
      // minute of pure waste.
      if (!attachment.storageId) {
        return attachment;
      }

      const url = await getCachedStorageUrl(ctx, cache, attachment.storageId);
      return {
        ...attachment,
        ...(url ? { url } : {}),
      };
    }),
  );
}

// Mention chips render with the integration's store branding; look it up live
// (mention → install row → store listing) so logos never go stale in old
// messages. Uninstalled/unbranded mentions fall back to the chip's plug icon.
async function hydrateIntegrationMentions(
  ctx: any,
  cache: MessageHydrationCache,
  mentions: { serverId: string; name: string }[] | undefined,
) {
  if (!mentions) {
    return mentions;
  }

  return await Promise.all(
    mentions.map(async (mention) => {
      const server = await getCachedDocument(ctx, cache, mention.serverId);
      const listing = server?.integrationId
        ? await getCachedDocument(ctx, cache, server.integrationId)
        : null;
      return {
        ...mention,
        logoUrl: listing?.logoId
          ? await getCachedStorageUrl(ctx, cache, listing.logoId)
          : null,
        iconSvg: listing?.iconSvg,
      };
    }),
  );
}

// Skill mention chips work the same way: mention → install row → skill
// listing, hydrated live so branding never goes stale in old messages.
async function hydrateSkillMentions(
  ctx: any,
  cache: MessageHydrationCache,
  mentions: { installId: string; name: string }[] | undefined,
) {
  if (!mentions) {
    return mentions;
  }

  return await Promise.all(
    mentions.map(async (mention) => {
      const install = await getCachedDocument(ctx, cache, mention.installId);
      const listing = install
        ? await getCachedDocument(ctx, cache, install.skillId)
        : null;
      return {
        ...mention,
        logoUrl: listing?.logoId
          ? await getCachedStorageUrl(ctx, cache, listing.logoId)
          : null,
        iconSvg: listing?.iconSvg,
      };
    }),
  );
}

async function getCurrentUserId(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Not authenticated");
  }
  return identity.subject;
}

// Kick off the server-driven turn for a freshly minted stream (see
// convex/turns.ts). The display name is captured here because the scheduled
// action has no ctx.auth to read it from.
async function scheduleAssistantTurn(
  ctx: any,
  { streamId, userId }: { streamId: string; userId: string },
) {
  await scheduleTurn(ctx, {
    streamId,
    userId,
    userName: await displayNameFromIdentity(ctx),
  });
}

async function getOwnedThread(ctx: any, threadId: string) {
  const userId = await getCurrentUserId(ctx);
  const thread = await ctx.db.get(threadId);

  if (!thread || thread.userId !== userId) {
    throw new Error("Thread not found");
  }

  return { thread, userId };
}

/* The plaintext paths must never touch a locked thread: a body written here
   lands in the clear, and every one of these schedules a server-side turn
   that would read the conversation. Locked threads have their own mutations
   (convex/lockedThreads.ts) where the body arrives already sealed. */
function refuseIfLocked(thread: any) {
  if (thread.lock) {
    throw new ConvexError(
      "This chat is locked. Unlock it first.",
    );
  }
}

async function getOwnedMessage(
  ctx: any,
  threadId: string,
  messageId: string,
  expectedRole?: "user" | "assistant",
) {
  await getOwnedThread(ctx, threadId);
  const message = await ctx.db.get(messageId);

  if (!message || message.threadId !== threadId) {
    throw new Error("Message not found");
  }

  if (expectedRole && message.role !== expectedRole) {
    throw new Error("Unexpected message type");
  }

  return message;
}

export const recentUsage = queryGeneric({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject;
    const cap = Math.max(1, Math.min(limit ?? 50, 200));

    const rows = await ctx.db
      .query("messages")
      .withIndex("by_user_role_created_at", (q: any) =>
        q.eq("userId", userId).eq("role", "assistant"),
      )
      .order("desc")
      .filter((q: any) => q.neq(q.field("usageCost"), undefined))
      .take(cap);

    const messageUsage = rows
      .filter((m: any) => typeof m.usageCost === "number" && m.usageCost > 0)
      .map((m: any) => {
        const phases = (m.phases ?? []) as any[];
        let searchSources = 0;
        let thoughtMs = 0;
        for (const p of phases) {
          if (p.kind === "search" && typeof p.sources === "number") {
            searchSources += p.sources;
          } else if (p.kind === "thought" && typeof p.durationMs === "number") {
            thoughtMs += p.durationMs;
          }
        }
        // Token accounting is best-effort (absent on legacy rows) — nulls
        // let the client tell "no data" apart from a genuine zero.
        const tokens = (value: unknown) =>
          typeof value === "number" ? value : null;
        return {
          id: m._id,
          threadId: m.threadId,
          createdAt: m.createdAt,
          model: m.model ?? "Auto",
          thinking: !!m.thinking,
          search: !!m.search,
          usageCost: m.usageCost as number,
          extraUsageCost:
            typeof m.extraUsageCost === "number" ? m.extraUsageCost : 0,
          searchSources,
          thoughtMs,
          inputTokens: tokens(m.inputTokens),
          outputTokens: tokens(m.outputTokens),
          cacheReadTokens: tokens(m.cacheReadTokens),
          cacheWriteTokens: tokens(m.cacheWriteTokens),
          totalTokens: tokens(m.totalTokens),
          promptContentTokens: tokens(m.promptContentTokens),
        };
      });

    const threads = await ctx.db
      .query("threads")
      .withIndex("by_user_updated_at", (q: any) => q.eq("userId", userId))
      .collect();

    const compactionUsage: {
      id: string;
      threadId: string;
      createdAt: number;
      model: string;
      thinking: boolean;
      search: boolean;
      usageCost: number;
      extraUsageCost: number;
      searchSources: number;
      thoughtMs: number;
      inputTokens: number | null;
      outputTokens: number | null;
      cacheReadTokens: number | null;
      cacheWriteTokens: number | null;
      totalTokens: number | null;
      promptContentTokens: number | null;
    }[] = [];

    for (const thread of threads) {
      const events = (thread.compactionUsage ?? []) as {
        cost: number;
        createdAt: number;
        extraCost?: number;
      }[];
      for (let i = 0; i < events.length; i += 1) {
        const event = events[i];
        if (typeof event.cost !== "number" || event.cost <= 0) continue;
        compactionUsage.push({
          id: `${thread._id}:compact:${i}`,
          threadId: thread._id,
          createdAt: event.createdAt,
          model: "Compact",
          thinking: false,
          search: false,
          usageCost: event.cost,
          extraUsageCost:
            typeof event.extraCost === "number" ? event.extraCost : 0,
          searchSources: 0,
          thoughtMs: 0,
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          totalTokens: null,
          promptContentTokens: null,
        });
      }
    }

    // Legacy Memory Index runs billed token spend but weren't tied to a single
    // thread; surface those completed runs as their own "Index" line item.
    const indexRuns = await ctx.db
      .query("memoryIndexRuns")
      .withIndex("by_user_started_at", (q: any) => q.eq("userId", userId))
      .order("desc")
      .take(cap);

    const indexUsage = indexRuns
      .filter(
        (r: any) =>
          r.status === "complete" &&
          typeof r.cost === "number" &&
          r.cost > 0,
      )
      .map((r: any) => ({
        id: `${r._id}:index`,
        threadId: "",
        createdAt: r.finishedAt ?? r.startedAt,
        model: "Index",
        thinking: false,
        search: false,
        usageCost: r.cost as number,
        extraUsageCost:
          typeof r.extraCost === "number" ? r.extraCost : 0,
        searchSources: 0,
        thoughtMs: 0,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        totalTokens: null,
        promptContentTokens: null,
      }));

    return [...messageUsage, ...compactionUsage, ...indexUsage]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, cap);
  },
});

export const listForThread = queryGeneric({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, { threadId }) => {
    await getOwnedThread(ctx, threadId);

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_created_at", (q: any) => q.eq("threadId", threadId))
      .collect();
    const hydrationCache = createMessageHydrationCache();

    return await Promise.all(
      messages.map((message: any) =>
        formatMessage(ctx, message, hydrationCache),
      ),
    );
  },
});

export const generateAttachmentUploadUrl = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const sendUserMessage = mutationGeneric({
  args: {
    threadId: v.optional(v.id("threads")),
    content: v.string(),
    attachments: v.optional(v.array(attachmentValidator)),
    // Integrations the user @mentioned in the composer. Verified against their
    // own installs below; the stream preloads these servers' tools this turn.
    integrations: v.optional(v.array(integrationMentionValidator)),
    // Skills the user @mentioned in the composer. Verified against their own
    // installs below; the stream preloads these skills' instructions.
    skills: v.optional(v.array(skillMentionValidator)),
    options: v.optional(sendOptionsValidator),
    // Start (or continue) an incognito thread: nothing here is meant to outlive
    // the session. We skip the title model entirely (the thread is hidden, so a
    // title would just be wasted spend) and flag the thread so the inference
    // path skips memory + compaction and the listing query hides it.
    incognito: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { threadId, content, attachments, integrations, skills, options, incognito },
  ) => {
    const userId = await getCurrentUserId(ctx);
    const now = Date.now();

    // Ownership-checked and name-snapshotted — the client's labels are
    // never trusted (see convex/turns.ts).
    const { mentions, skillMentions } = await verifyMentions(
      ctx,
      userId,
      integrations,
      skills,
    );

    const recentMessages = await ctx.db
      .query("messages")
      .withIndex("by_user_role_created_at", (q: any) =>
        q
          .eq("userId", userId)
          .eq("role", "user")
          .gte("createdAt", now - RATE_LIMIT_WINDOW_MS),
      )
      .take(RATE_LIMIT_MAX_MESSAGES + 1);
    if (recentMessages.length >= RATE_LIMIT_MAX_MESSAGES) {
      throw new Error(
        "You're sending messages too quickly. Please wait a moment and try again.",
      );
    }

    // Tier keys pass through; catalog slugs only while that model is live —
    // a stale pick (deleted/disabled model) quietly rides as Auto, so a send
    // can never fail over catalog state.
    const model = await resolveSendModel(ctx.db, options?.model);

    let resolvedThreadId = threadId;
    let scheduleTitleFor: string | null = null;
    if (!resolvedThreadId) {
      if (incognito) {
        // No generated title: the thread is hidden and short-lived.
        resolvedThreadId = await ctx.db.insert("threads", {
          userId,
          title: "Incognito chat",
          titleStatus: "ready",
          createdAt: now,
          updatedAt: now,
          model,
          incognito: true,
        });
      } else {
        scheduleTitleFor = titlePromptInput(content);
        resolvedThreadId = await ctx.db.insert("threads", {
          userId,
          title: fallbackTitleFromPrompt(scheduleTitleFor),
          titleStatus: "generating",
          createdAt: now,
          updatedAt: now,
          model,
        });
      }
    } else {
      const { thread } = await getOwnedThread(ctx, resolvedThreadId);
      refuseIfLocked(thread);
      await ctx.db.patch(resolvedThreadId, {
        updatedAt: now,
        model,
      });
    }

    // The rows and the scheduled turn — shared with the message queue, so a
    // message that waited its turn starts exactly like one that didn't.
    const { userMessageId, assistantId, streamId } = await appendUserTurn(
      ctx,
      {
        threadId: resolvedThreadId,
        userId,
        content,
        attachments,
        mentions,
        skillMentions,
        options,
        model,
        userName: await displayNameFromIdentity(ctx),
        now,
      },
    );

    if (scheduleTitleFor !== null) {
      await ctx.scheduler.runAfter(0, internal.inference.generateThreadTitle, {
        threadId: resolvedThreadId,
        prompt: scheduleTitleFor,
      });
    }

    // Funnel step 3: the first message this account ever sent. Scheduled rather
    // than awaited inline so the milestone read never sits between the user
    // pressing enter and the turn starting; convex/funnel.ts makes sure it can
    // only ever count once, however many sends land here.
    await ctx.scheduler.runAfter(0, internal.funnel.reachMilestone, {
      userId,
      milestone: "first_chat" as const,
      properties: { model, incognito: incognito === true },
    });

    return {
      threadId: resolvedThreadId,
      userMessageId,
      assistantId,
      streamId,
    };
  },
});

export const getStreamBody = queryGeneric({
  args: {
    streamId: StreamIdValidator,
  },
  handler: async (ctx, { streamId }) => {
    const userId = await getCurrentUserId(ctx);
    const message = await ctx.db
      .query("messages")
      .withIndex("by_stream_id", (q: any) => q.eq("streamId", streamId))
      .first();

    if (!message || message.userId !== userId) {
      throw new Error("Stream not found");
    }

    return await persistentTextStreaming.getStreamBody(
      ctx,
      streamId as StreamId,
    );
  },
});

export const updateUserMessage = mutationGeneric({
  args: {
    threadId: v.id("threads"),
    messageId: v.id("messages"),
    content: v.string(),
  },
  handler: async (ctx, { threadId, messageId, content }) => {
    const now = Date.now();
    const { thread } = await getOwnedThread(ctx, threadId);
    refuseIfLocked(thread);
    await getOwnedMessage(ctx, threadId, messageId, "user");

    await ctx.db.patch(messageId, {
      content,
      updatedAt: now,
    });

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_created_at", (q: any) => q.eq("threadId", threadId))
      .collect();

    const firstUserMessage = messages.find((message: any) => message.role === "user");
    if (firstUserMessage?._id === messageId) {
      const titlePrompt = titlePromptInput(content);
      await ctx.db.patch(threadId, {
        title: fallbackTitleFromPrompt(titlePrompt),
        titleStatus: "generating",
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.inference.generateThreadTitle, {
        threadId,
        prompt: titlePrompt,
      });
    }

    return null;
  },
});

export const prepareAssistantRetryFromUser = mutationGeneric({
  args: {
    threadId: v.id("threads"),
    userMessageId: v.id("messages"),
  },
  handler: async (ctx, { threadId, userMessageId }) => {
    const { thread } = await getOwnedThread(ctx, threadId);
    refuseIfLocked(thread);
    await getOwnedMessage(ctx, threadId, userMessageId, "user");

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_created_at", (q: any) => q.eq("threadId", threadId))
      .collect();

    const userIndex = messages.findIndex((message: any) => message._id === userMessageId);
    const existingAssistant = messages
      .slice(userIndex + 1)
      .find((message: any) => message.role === "assistant");

    const now = Date.now();

    if (existingAssistant) {
      const streamId = await persistentTextStreaming.createStream(ctx);
      await ctx.db.patch(existingAssistant._id, {
        content: "",
        status: "streaming",
        phases: [],
        // Generated images from the previous run must not linger under the
        // fresh skeleton — the retry attaches its own.
        attachments: [],
        streamId,
        model: existingAssistant.model ?? "Auto",
        thinking: existingAssistant.thinking ?? false,
        search: existingAssistant.search ?? false,
        usageCost: 0,
        addedMemoryIds: [],
        updatedAt: now,
      });

      await scheduleAssistantTurn(ctx, {
        streamId,
        userId: existingAssistant.userId,
      });

      return { assistantId: existingAssistant._id, streamId };
    }

    const streamId = await persistentTextStreaming.createStream(ctx);
    const assistantId = await ctx.db.insert("messages", {
      threadId,
      userId: messages[userIndex].userId,
      role: "assistant",
      content: "",
      createdAt: now,
      updatedAt: now,
      status: "streaming",
      phases: [],
      streamId,
      model: "Auto",
      thinking: false,
      search: false,
    });

    await ctx.db.patch(threadId, {
      updatedAt: now,
    });

    await scheduleAssistantTurn(ctx, {
      streamId,
      userId: messages[userIndex].userId,
    });

    return { assistantId, streamId };
  },
});

export const resetAssistantMessage = mutationGeneric({
  args: {
    threadId: v.id("threads"),
    messageId: v.id("messages"),
  },
  handler: async (ctx, { threadId, messageId }) => {
    const now = Date.now();
    const { thread } = await getOwnedThread(ctx, threadId);
    refuseIfLocked(thread);
    const message = await getOwnedMessage(ctx, threadId, messageId, "assistant");
    const streamId = await persistentTextStreaming.createStream(ctx);

    await ctx.db.patch(messageId, {
      content: "",
      status: "streaming",
      phases: [],
      // Clear any generated images from the previous run so the fresh
      // skeleton doesn't sit above a stale picture.
      attachments: [],
      streamId,
      model: message.model ?? "Auto",
      thinking: message.thinking ?? false,
      search: message.search ?? false,
      usageCost: 0,
      addedMemoryIds: [],
      updatedAt: now,
    });

    await ctx.db.patch(threadId, {
      updatedAt: now,
    });

    await scheduleAssistantTurn(ctx, { streamId, userId: message.userId });

    return { assistantId: messageId, streamId };
  },
});

// Records the user's form answers onto the message's `question` phase (the
// newest unanswered one), so the card can render what was chosen and the
// composer knows not to offer the form again. The serialized answers are sent
// separately as an ordinary user message — this only settles the widget.
export const answerQuestionPhase = mutationGeneric({
  args: {
    threadId: v.id("threads"),
    messageId: v.id("messages"),
    answers: v.array(questionAnswerValidator),
  },
  handler: async (ctx, { threadId, messageId, answers }) => {
    const message = await getOwnedMessage(ctx, threadId, messageId, "assistant");

    const phases = [...(message.phases ?? [])];
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "question" && !phase.pending && !phase.answered) {
        phases[i] = { ...phase, answers, answered: true };
        await ctx.db.patch(messageId, {
          phases,
          updatedAt: Date.now(),
        });
        return null;
      }
    }

    throw new Error("There's no open question on this message to answer.");
  },
});

export const updateAssistantMessage = mutationGeneric({
  args: {
    threadId: v.id("threads"),
    messageId: v.id("messages"),
    content: v.optional(v.string()),
    status: v.optional(messageStatusValidator),
    phases: v.optional(v.array(phaseValidator)),
  },
  handler: async (ctx, args) => {
    const { threadId, messageId, content, status, phases } = args;
    const now = Date.now();

    await getOwnedMessage(ctx, threadId, messageId, "assistant");

    const patch: Record<string, unknown> = {
      updatedAt: now,
    };

    if (content !== undefined) {
      patch.content = content;
    }
    if (status !== undefined) {
      patch.status = status;
    }
    if (phases !== undefined) {
      patch.phases = phases;
    }

    await ctx.db.patch(messageId, patch);
    await ctx.db.patch(threadId, {
      updatedAt: now,
    });

    // Stop is a settle too: whatever was queued behind this reply goes now.
    if (status === "complete" || status === "stopped" || status === "error") {
      await drainQueuedMessages(ctx, threadId);
    }

    return null;
  },
});
