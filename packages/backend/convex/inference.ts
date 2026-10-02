import { StreamIdValidator } from "@convex-dev/persistent-text-streaming";
import type { UserContent } from "ai";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { readDocumentBody, readHtmlBody } from "./artifactContent";
import { readCompactionSummary } from "./threadCompaction";
import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  assistantHistoryEvents,
  type AttachmentForPrompt,
  historyEventsBlock,
  hydrateAttachmentUrls,
  messageContentForModel,
  toContentParts,
  withHistoryEvents,
  type AttachmentStorage,
} from "./inference/attachments";
import {
  FREE_MAX_FILE_BYTES,
  MODEL_ACCEPTS_NATIVE_FILES,
  resolveModelKey,
} from "./inference/billing";
import {
  finalizeAssistantTurn as finalizeAssistantTurnHandler,
  finalizeAssistantTurnArgs,
} from "./inference/finalize";
import {
  handleStreamAssistant,
  runAssistantTurn as runAssistantTurnHandler,
  streamAssistantOptionsResponse,
} from "./inference/stream";
import { regenerateThreadTitleFromThread } from "./inference/titleRegen";
import { generateThreadTitleForPrompt } from "./inference/titles";
import { drainQueuedMessages } from "./messageQueue";
import { readCustomModel, readTierOverride } from "./models";
import { documentShareLink, visualShareLink } from "./shareLinks";
import { listRuntimeCustomSkills } from "./customSkills";
import { listRuntimeSkills } from "./skillStore";
import {
  attachmentValidator,
  calcItemValidator,
  chartSpecValidator,
  messageStatusValidator,
  phaseValidator,
  questionSpecValidator,
  searchSourceValidator,
  settledPhases,
  weatherDayValidator,
  weatherHourValidator,
} from "./validators";

const SUPERMEMORY_ATTACHMENT_TEXT_BUDGET = 12_000;

function messageTextForSupermemory(message: {
  content: string;
  attachments?: AttachmentForPrompt[];
}) {
  const parts: string[] = [];
  const content = message.content.trim();
  if (content) parts.push(content);

  let budget = SUPERMEMORY_ATTACHMENT_TEXT_BUDGET;
  for (const attachment of message.attachments ?? []) {
    const text = attachment.text?.trim();
    if (!text || budget <= 0) continue;
    const body =
      text.length > budget ? `${text.slice(0, budget)}\n[truncated]` : text;
    parts.push(`Attachment: ${attachment.name}\n${body}`);
    budget -= Math.min(text.length, budget);
  }

  return parts.join("\n\n");
}

export const getRequestForStream = internalQuery({
  args: {
    streamId: StreamIdValidator,
    // Captured by the (authenticated) mutation that scheduled this turn —
    // the scheduled action calling in has no ctx.auth of its own.
    userId: v.string(),
    userName: v.optional(v.string()),
  },
  handler: async (ctx, { streamId, userId, userName }) => {
    const assistant = await ctx.db
      .query("messages")
      .withIndex("by_stream_id", (q) => q.eq("streamId", streamId))
      .first();

    if (!assistant || assistant.userId !== userId) {
      throw new Error("Stream not found");
    }

    const thread = await ctx.db.get(assistant.threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }

    let compactionBoundaryCreatedAt = 0;
    if (thread.compactionBoundary) {
      const boundaryMessage = await ctx.db.get(thread.compactionBoundary);
      if (boundaryMessage) {
        compactionBoundaryCreatedAt = boundaryMessage.createdAt;
      }
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_created_at", (q) =>
        q
          .eq("threadId", assistant.threadId)
          .gt("createdAt", compactionBoundaryCreatedAt)
          .lt("createdAt", assistant.createdAt),
      )
      .collect();

    // These reads are independent once the thread history is loaded. Launch
    // them together so request setup pays for one database round-trip window
    // instead of serially waiting on settings, integrations, skills, and
    // artifacts.
    const [
      preferences,
      userContext,
      memorySettings,
      mcpServerRows,
      runtimeSkills,
      customSkills,
      threadDocumentRows,
      threadHtmlArtifactRows,
    ] = await Promise.all([
      ctx.db
        .query("userPreferences")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
      ctx.db
        .query("userContext")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
      // Memory is still user-controlled from settings, but Supermemory now
      // owns retrieval and extraction in the action layer.
      ctx.db
        .query("memorySettings")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
      ctx.db
        .query("mcpServers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
      listRuntimeSkills(ctx, userId),
      listRuntimeCustomSkills(ctx, userId),
      ctx.db
        .query("documents")
        .withIndex("by_thread", (q) => q.eq("threadId", assistant.threadId))
        .take(50),
      ctx.db
        .query("htmlArtifacts")
        .withIndex("by_thread", (q) => q.eq("threadId", assistant.threadId))
        .take(50),
    ]);

    // MCP servers (paid-only): the user's enabled remote servers, with their
    // header ciphertext. The stream action hands the model just each server's
    // name + description and lets it discover tools on demand — this query
    // stays free of Autumn calls and never decrypts, mirroring how memories
    // are surfaced. Store-installed servers borrow their store listing's
    // description so the prompt can say what the integration is for;
    // hand-added servers go in by name alone.
    // Integrations the user has @mentioned anywhere in this thread (well,
    // the post-compaction history). A mention persists: once tagged, the
    // integration's toolset stays preloaded on every later turn instead of
    // waiting on lazy discovery. It's a suggestion, never a scope — untagged
    // integrations remain available through the gateway tools.
    const mentionedServerIds = new Set(
      messages
        .filter((message) => message.role === "user")
        .flatMap((message) =>
          (message.integrations ?? []).map((m) => m.serverId),
        ),
    );
    const mcpServers = await Promise.all(
      mcpServerRows
        // Enabled only — and a Composio-backed install must also have its
        // account connected (the install-time link flow) before the model
        // may see it, mirroring how unconnected OAuth servers drop out in
        // the stream's config resolution.
        .filter(
          (row) => row.enabled && (!row.composio || row.composio.connected),
        )
        .map(async (row) => {
          const listing = row.integrationId
            ? await ctx.db.get(row.integrationId)
            : null;
          return {
            id: row._id,
            name: row.name,
            url: row.url,
            mentioned: mentionedServerIds.has(row._id),
            description: listing?.description,
            // Store-configured lifecycle copy travels with the runtime config
            // and is snapshotted onto phases. Hand-added MCP servers simply
            // have no metadata and retain the generic fallback.
            tools: listing?.tools ?? [],
            authMode: row.authMode ?? "headers",
            headers: (row.headers ?? []).map((h) => ({
              key: h.key,
              valueCipher: h.valueCipher,
            })),
            oauth: row.oauth
              ? {
                  clientId: row.oauth.clientId,
                  clientSecretCipher: row.oauth.clientSecretCipher,
                  tokenEndpoint: row.oauth.tokenEndpoint,
                  scope: row.oauth.scope,
                  resource: row.oauth.resource,
                  accessTokenCipher: row.oauth.accessTokenCipher,
                  refreshTokenCipher: row.oauth.refreshTokenCipher,
                  expiresAt: row.oauth.expiresAt,
                  connected: row.oauth.connected,
                }
              : undefined,
          };
        }),
    );

    // Installed skills (paid-only, like integrations): name + description
    // only — except @mentioned ones, whose full instructions ride along so
    // the stream can preload them into the prompt. Like integration mentions,
    // a tag anywhere in the (post-compaction) history persists for the whole
    // thread. Unmentioned skills stay lazy via the load_skill tool.
    const mentionedSkillInstallIds = new Set(
      messages
        .filter((message) => message.role === "user")
        .flatMap((message) =>
          (message.skills ?? []).map((m) => m.installId),
        ),
    );
    const installedSkills = await Promise.all(
      runtimeSkills.map(async (skill) => {
        const mentioned = mentionedSkillInstallIds.has(skill.installId);
        return {
          name: skill.name,
          description: skill.description,
          mentioned,
          ...(mentioned
            ? {
                instructions: (await ctx.db.get(skill.skillId))?.instructions,
              }
            : {}),
        };
      }),
    );
    // Custom skills (written by hand in settings) join the same list. They
    // aren't @mentionable, so they always stay lazy behind load_skill.
    installedSkills.push(
      ...customSkills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        mentioned: false,
      })),
    );

    // Documents whirl has already authored in this thread, with their CURRENT
    // text, so editDocument can target one by id and copy exact anchors from
    // what's actually stored now (the fix for the old blind-edit failure storm).
    // Only finished docs — a doc still streaming this turn isn't editable yet.
    // Bounded by take(); prompt-side budgeting caps how much text is injected.
    // Bodies live in side rows now, so this is the one read path that still
    // pays for them — editDocument can't anchor on text it hasn't been shown.
    const threadDocuments = await Promise.all(
      threadDocumentRows
        .filter((doc) => doc.status !== "streaming")
        .map(async (doc) => ({
          id: doc._id,
          title: doc.title,
          content: await readDocumentBody(ctx, doc),
          format: doc.format ?? "markdown",
          ...(doc.fileName ? { fileName: doc.fileName } : {}),
          ...(doc.language ? { language: doc.language } : {}),
          ...(doc.shortId ? { link: documentShareLink(doc.shortId) } : {}),
        })),
    );

    // HTML artifacts (paid-only) whirl has finished in this thread, with their
    // CURRENT html, so editHtml can target one by id and copy exact anchors.
    // Only completed ones — a viz still streaming or a page still generating
    // this turn isn't editable yet. Budgeted prompt-side like documents.
    const threadHtmlArtifacts = await Promise.all(
      threadHtmlArtifactRows
        .filter((row) => row.status === "complete")
        .map(async (row) => ({
          id: row._id,
          title: row.title,
          mode: row.kind,
          runtime: row.runtime ?? ("html" as const),
          content: await readHtmlBody(ctx, row),
          ...((row.bindings?.length ?? 0) > 0
            ? { bindings: (row.bindings ?? []).map((b) => b.id) }
            : {}),
          // A react artifact that reads live data is withheld from public
          // share links, so it must not be offered one here either.
          ...(row.shortId && (row.bindings?.length ?? 0) === 0
            ? { link: visualShareLink(row.shortId) }
            : {}),
        })),
    );

    // id → public share link, for the history breadcrumbs on artifact
    // phases (messageContentForModel) — so the model can hand the user a
    // link to anything it made earlier in the thread.
    const shareLinks = {
      documents: Object.fromEntries(
        threadDocuments
          .filter((doc) => doc.link)
          .map((doc) => [doc.id as string, doc.link as string]),
      ),
      html: Object.fromEntries(
        threadHtmlArtifacts
          .filter((row) => row.link)
          .map((row) => [row.id as string, row.link as string]),
      ),
    };


    const attachmentStorage = ctx.storage as unknown as AttachmentStorage;
    const history = messages.map(async (message) => ({
      ...message,
      attachments: await hydrateAttachmentUrls(
        attachmentStorage,
        message.attachments,
      ),
    }));

    const hydratedHistory = await Promise.all(history);
    // Tiers without native file input (kimi, nano) read documents as text
    // extracted at upload; binaries with none (scanned PDFs) get omitted with
    // a note instead of a file block the provider would reject. A custom
    // catalog model or an admin tier override answers from its detected
    // capabilities instead.
    const requestModelKey = resolveModelKey(assistant.model ?? "Auto");
    const fileOverride =
      (await readCustomModel(ctx.db, assistant.model)) ??
      (await readTierOverride(ctx.db, requestModelKey));
    const nativeFiles =
      fileOverride?.capabilities.files ??
      MODEL_ACCEPTS_NATIVE_FILES[requestModelKey];
    // Assistant turns go in as prose and nothing else. What their tools did
    // rides ahead of the NEXT user turn in a <whirl_system_log> block instead
    // — because a turn that only painted a picture has no prose, so the old
    // in-message breadcrumb was the entire assistant message, and the model
    // dutifully wrote another one (fabricated storage URL and all) the next
    // time it was asked for an image. An assistant message with nothing left
    // in it is dropped rather than sent empty.
    const modelMessages: {
      role: "user" | "assistant";
      content: UserContent;
    }[] = [];
    const pushUserContent = (content: UserContent) => {
      // Dropping the note-only assistant turns can leave two user turns
      // adjacent; merge them so every provider sees a clean alternation.
      const previous = modelMessages[modelMessages.length - 1];
      if (previous?.role === "user") {
        previous.content = [
          ...toContentParts(previous.content),
          ...toContentParts(content),
        ];
        return;
      }
      modelMessages.push({ role: "user", content });
    };

    let pendingEvents: string[] = [];
    for (const message of hydratedHistory) {
      if (message.role === "assistant") {
        pendingEvents.push(...assistantHistoryEvents(message, { shareLinks }));
        const prose = message.content.trim();
        if (prose) modelMessages.push({ role: "assistant", content: prose });
        continue;
      }
      pushUserContent(
        withHistoryEvents(
          messageContentForModel(message, { nativeFiles }),
          pendingEvents,
        ),
      );
      pendingEvents = [];
    }
    // Trailing tool work with no user turn after it (a retry picking up where
    // the last assistant left off) still has to reach the model.
    if (pendingEvents.length > 0) {
      pushUserContent(historyEventsBlock(pendingEvents));
    }

    // Whether the user turn driving this response carried a non-image attachment
    // larger than the free-tier cap, used to enforce that cap server-side. Free
    // uploads are allowed up to FREE_MAX_FILE_BYTES; anything bigger is a paid
    // perk. Images are exempt — they're auto-compressed before upload, mirroring
    // the client gate in attachmentRejectionReason.
    const lastUserMessage = [...hydratedHistory]
      .reverse()
      .find((message) => message.role === "user");
    const hasOversizedAttachment = Boolean(
      lastUserMessage?.attachments?.some(
        (a) => a.size > FREE_MAX_FILE_BYTES && !a.type?.startsWith("image/"),
      ),
    );
    const latestUserText = lastUserMessage
      ? messageTextForSupermemory(lastUserMessage)
      : "";
    const latestMessageHasRuntimeMentions = Boolean(
      lastUserMessage?.integrations?.length || lastUserMessage?.skills?.length,
    );

    // Inputs for the Image tier. The driving user turn's raw text plus its
    // image attachments in stored order — that order IS the @imgN numbering
    // contract the composer showed the user — and the most recent generated
    // image in the visible history, which is the edit target on follow-ups.
    const latestUserImages = (lastUserMessage?.attachments ?? [])
      .filter(
        (attachment) =>
          attachment.type?.startsWith("image/") &&
          (attachment.storageId || attachment.url || attachment.data),
      )
      .map((attachment) => ({
        name: attachment.name,
        // The storage row is what the Images API path reads bytes from; the
        // URL is the fallback for attachments that predate it.
        storageId: attachment.storageId,
        url: attachment.url ?? attachment.data,
        type: attachment.type,
      }));
    let lastGeneratedImage: {
      name: string;
      url: string;
      type: string;
      storageId?: Id<"_storage">;
    } | null = null;
    for (let i = hydratedHistory.length - 1; i >= 0; i -= 1) {
      const message = hydratedHistory[i];
      if (message.role !== "assistant") continue;
      const image = [...(message.attachments ?? [])]
        .reverse()
        .find(
          (attachment) => attachment.type?.startsWith("image/") && attachment.url,
        );
      if (image?.url) {
        lastGeneratedImage = {
          name: image.name,
          url: image.url,
          type: image.type || "image/png",
          storageId: image.storageId,
        };
        break;
      }
    }

    // Vision handoff: assistant history only carries a system-log line for
    // generated images (see assistantHistoryEvents), so when the NEXT turn
    // runs a text model, re-attach the most recent generated image to the
    // latest user message — that's how "switch models and ask about the
    // image" works. Image turns skip this and feed the same image through the
    // Images API's input_references instead.
    if (lastGeneratedImage && (assistant.model ?? "Auto") !== "Image") {
      for (let i = modelMessages.length - 1; i >= 0; i -= 1) {
        if (modelMessages[i].role !== "user") continue;
        const parts = toContentParts(modelMessages[i].content);
        parts.push({
          type: "text",
          text: `(The image whirl generated earlier in this conversation, for reference — ${lastGeneratedImage.name}:)`,
        });
        parts.push({
          type: "image",
          image: lastGeneratedImage.url,
          mediaType: lastGeneratedImage.type,
        });
        modelMessages[i] = { role: "user", content: parts };
        break;
      }
    }

    return {
      assistantId: assistant._id,
      streamId,
      threadId: assistant.threadId,
      model: assistant.model ?? "Auto",
      thinking: assistant.thinking ?? false,
      search: assistant.search ?? false,
      // Incognito turns still cost money (the user is billed normally), but the
      // conversation is never written to memory and never auto-compacts.
      incognito: thread.incognito ?? false,
      hasOversizedAttachment,
      compactionSummary: await readCompactionSummary(ctx, thread),
      userPreferences: preferences?.text,
      userName,
      timeZone: userContext?.timeZone,
      locale: userContext?.locale,
      unitsSystem: userContext?.unitsSystem,
      latitude: userContext?.latitude,
      longitude: userContext?.longitude,
      place: userContext?.place,
      latestUserText,
      latestMessageHasRuntimeMentions,
      imageRequest: {
        prompt: lastUserMessage?.content ?? "",
        userImages: latestUserImages,
        lastGeneratedImage,
      },
      memoryEnabled: memorySettings?.enabled ?? true,
      mcpServers,
      installedSkills,
      threadDocuments,
      threadHtmlArtifacts,
      messages: modelMessages,
    };
  },
});

export const getAssistantStatus = internalQuery({
  args: {
    assistantId: v.id("messages"),
  },
  handler: async (ctx, { assistantId }) => {
    const message = await ctx.db.get(assistantId);
    return message?.status ?? null;
  },
});

export const setAssistantStatus = internalMutation({
  args: {
    assistantId: v.id("messages"),
    status: messageStatusValidator,
    content: v.optional(v.string()),
  },
  handler: async (ctx, { assistantId, status, content }) => {
    const patch: Record<string, unknown> = {
      status,
      updatedAt: Date.now(),
    };
    if (content !== undefined) {
      patch.content = content;
    }
    // Entering a live status starts the watchdog's liveness clock; the stream
    // handler keeps it beating from there (recordAssistantHeartbeat).
    const live =
      status === "thinking" || status === "searching" || status === "streaming";
    if (live) {
      patch.heartbeatAt = Date.now();
    }
    await ctx.db.patch(assistantId, patch);

    // A settled reply is what a queued message has been waiting for. Same
    // transaction as the status, so nothing can slip in between.
    if (!live) {
      const assistant = await ctx.db.get(assistantId);
      if (assistant) await drainQueuedMessages(ctx, assistant.threadId);
    }
  },
});

export const addAssistantPhase = internalMutation({
  args: {
    assistantId: v.id("messages"),
    phase: phaseValidator,
  },
  handler: async (ctx, { assistantId, phase }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    await ctx.db.patch(assistantId, {
      phases: [...(assistant.phases ?? []), phase],
      updatedAt: Date.now(),
    });
  },
});

// Appends a generated image to the assistant message it belongs to. The image
// lands as a regular attachment row (storageId-backed), so the existing
// hydration in listForThread delivers it to the client reactively — the
// skeleton in the bubble morphs into the real image the moment this commits.
export const attachGeneratedImage = internalMutation({
  args: {
    assistantId: v.id("messages"),
    attachment: attachmentValidator,
  },
  handler: async (ctx, { assistantId, attachment }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    await ctx.db.patch(assistantId, {
      attachments: [...(assistant.attachments ?? []), attachment],
      updatedAt: Date.now(),
    });
  },
});

// A message's usage cost is written by the usage ledger now (see
// convex/usageLedger.ts): the row that records the charge is the same row that
// puts the number on the message, so the two can't disagree about what a turn
// cost. Nothing calls a standalone add-cost mutation any more.

// Records the per-response stats shown under a message ("Show stats"): the
// output-token count (reasoning included) and how long the response took. Both
// are optional so a provider that omitted usage still settles the rest.
export const setAssistantStats = internalMutation({
  args: {
    assistantId: v.id("messages"),
    outputTokens: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    // Full token accounting for the usage tab; same best-effort contract.
    inputTokens: v.optional(v.number()),
    cacheReadTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    promptContentTokens: v.optional(v.number()),
  },
  handler: async (
    ctx,
    {
      assistantId,
      outputTokens,
      durationMs,
      inputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      promptContentTokens,
    },
  ) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (typeof outputTokens === "number") patch.outputTokens = outputTokens;
    if (typeof durationMs === "number") patch.durationMs = durationMs;
    if (typeof inputTokens === "number") patch.inputTokens = inputTokens;
    if (typeof cacheReadTokens === "number")
      patch.cacheReadTokens = cacheReadTokens;
    if (typeof cacheWriteTokens === "number")
      patch.cacheWriteTokens = cacheWriteTokens;
    if (typeof totalTokens === "number") patch.totalTokens = totalTokens;
    if (typeof promptContentTokens === "number")
      patch.promptContentTokens = promptContentTokens;
    await ctx.db.patch(assistantId, patch);
  },
});

export const finalizeLastPendingSearch = internalMutation({
  args: {
    assistantId: v.id("messages"),
    sources: v.number(),
    items: v.optional(v.array(searchSourceValidator)),
  },
  handler: async (ctx, { assistantId, sources, items }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    const phases = [...(assistant.phases ?? [])];
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "search" && phase.pending) {
        phases[i] = {
          kind: "search",
          sources,
          ...(items !== undefined ? { items } : {}),
          ...(phase.contentOffset !== undefined
            ? { contentOffset: phase.contentOffset }
            : {}),
          ...(phase.query !== undefined ? { query: phase.query } : {}),
        };
        await ctx.db.patch(assistantId, {
          phases,
          updatedAt: Date.now(),
        });
        return;
      }
    }
  },
});

export const finalizeLastPendingFetch = internalMutation({
  args: {
    assistantId: v.id("messages"),
    sources: v.number(),
    items: v.optional(v.array(searchSourceValidator)),
  },
  handler: async (ctx, { assistantId, sources, items }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    const phases = [...(assistant.phases ?? [])];
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "fetch" && phase.pending) {
        phases[i] = {
          kind: "fetch",
          sources,
          ...(items !== undefined ? { items } : {}),
          ...(phase.contentOffset !== undefined
            ? { contentOffset: phase.contentOffset }
            : {}),
        };
        await ctx.db.patch(assistantId, {
          phases,
          updatedAt: Date.now(),
        });
        return;
      }
    }
  },
});

export const finalizeLastPendingWeather = internalMutation({
  args: {
    assistantId: v.id("messages"),
    place: v.optional(v.string()),
    approximate: v.optional(v.boolean()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    timezone: v.optional(v.string()),
    tempUnit: v.optional(v.union(v.literal("C"), v.literal("F"))),
    windUnit: v.optional(v.union(v.literal("km/h"), v.literal("mph"))),
    temp: v.optional(v.number()),
    apparentTemp: v.optional(v.number()),
    humidity: v.optional(v.number()),
    windSpeed: v.optional(v.number()),
    code: v.optional(v.number()),
    isDay: v.optional(v.boolean()),
    precipitation: v.optional(v.number()),
    hourly: v.optional(v.array(weatherHourValidator)),
    daily: v.optional(v.array(weatherDayValidator)),
    error: v.optional(v.string()),
    // Used only when no pending phase exists to inherit a position from.
    contentOffset: v.optional(v.number()),
  },
  handler: async (ctx, { assistantId, contentOffset, ...weather }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    const phases = [...(assistant.phases ?? [])];
    const buildPhase = (offset: number | undefined) => {
      const phase: Record<string, unknown> = { kind: "weather" as const };
      for (const [key, value] of Object.entries(weather)) {
        if (value !== undefined) phase[key] = value;
      }
      if (offset !== undefined) phase.contentOffset = offset;
      return phase as typeof phases[number];
    };

    // Prefer the pending phase opened on tool-input-start; some providers
    // deliver the call in one shot with no pending phase, so append instead.
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "weather" && phase.pending) {
        phases[i] = buildPhase(phase.contentOffset);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }

    phases.push(buildPhase(contentOffset));
    await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
  },
});

// Invisible mode: the weather tool fetched data for the model's own reasoning,
// so remove the pending weather phase opened on tool-input-start instead of
// finalizing it into a widget. No-op when no pending phase exists (one-shot
// providers that never opened one).
export const dropLastPendingWeather = internalMutation({
  args: {
    assistantId: v.id("messages"),
  },
  handler: async (ctx, { assistantId }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant?.phases) return;

    const phases = [...assistant.phases];
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "weather" && phase.pending) {
        phases.splice(i, 1);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }
  },
});

// Fill the pending `chart` phase with the validated spec so the card can
// draw. Mirrors the weather finalizer: prefer the phase opened on
// tool-input-start, and append instead when a provider delivered the whole
// call in one shot and never opened one.
export const finalizeLastPendingChart = internalMutation({
  args: {
    assistantId: v.id("messages"),
    chart: chartSpecValidator,
    // Used only when no pending phase exists to inherit a position from.
    contentOffset: v.optional(v.number()),
  },
  handler: async (ctx, { assistantId, chart, contentOffset }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    const phases = [...(assistant.phases ?? [])];
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "chart" && phase.pending) {
        phases[i] = {
          kind: "chart",
          chart,
          ...(phase.contentOffset !== undefined
            ? { contentOffset: phase.contentOffset }
            : {}),
        };
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }

    phases.push({
      kind: "chart",
      chart,
      ...(contentOffset !== undefined ? { contentOffset } : {}),
    });
    await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
  },
});

// The tool rejected the model's spec, so the skeleton it opened on
// tool-input-start has nothing coming. Drop it now rather than leaving a card
// spinning for the rest of the turn (the turn-end sweep would get it, but
// that can be many seconds of a chart that never arrives).
export const dropLastPendingChart = internalMutation({
  args: { assistantId: v.id("messages") },
  handler: async (ctx, { assistantId }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant?.phases) return;

    const phases = [...assistant.phases];
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "chart" && phase.pending) {
        phases.splice(i, 1);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }
  },
});

export const finalizeLastPendingCalc = internalMutation({
  args: {
    assistantId: v.id("messages"),
    // Single calculations carry expression/result; batch calls carry `items`.
    expression: v.optional(v.string()),
    result: v.optional(v.string()),
    needsLatex: v.optional(v.boolean()),
    label: v.optional(v.string()),
    expressionTex: v.optional(v.string()),
    resultTex: v.optional(v.string()),
    error: v.optional(v.string()),
    items: v.optional(v.array(calcItemValidator)),
    // Where the call landed in the text, used only when no pending phase
    // exists to inherit a position from.
    contentOffset: v.optional(v.number()),
  },
  handler: async (ctx, { assistantId, contentOffset, ...calc }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    const phases = [...(assistant.phases ?? [])];
    const buildPhase = (offset: number | undefined) => ({
      kind: "calc" as const,
      ...(calc.expression !== undefined
        ? { expression: calc.expression }
        : {}),
      ...(calc.result !== undefined ? { result: calc.result } : {}),
      ...(calc.needsLatex !== undefined
        ? { needsLatex: calc.needsLatex }
        : {}),
      ...(calc.label !== undefined ? { label: calc.label } : {}),
      ...(calc.expressionTex !== undefined
        ? { expressionTex: calc.expressionTex }
        : {}),
      ...(calc.resultTex !== undefined ? { resultTex: calc.resultTex } : {}),
      ...(calc.error !== undefined ? { error: calc.error } : {}),
      ...(calc.items !== undefined ? { items: calc.items } : {}),
      ...(offset !== undefined ? { contentOffset: offset } : {}),
    });

    // Prefer to fill the pending phase opened when the model started writing
    // the call. Some providers deliver a tool call in one shot without a
    // tool-input-start, so there may be nothing pending — append a finalized
    // phase in that case so the result always surfaces.
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "calc" && phase.pending) {
        phases[i] = buildPhase(phase.contentOffset);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }

    phases.push(buildPhase(contentOffset));
    await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
  },
});

export const finalizeLastPendingThought = internalMutation({
  args: {
    assistantId: v.id("messages"),
    durationMs: v.number(),
    text: v.optional(v.string()),
  },
  handler: async (ctx, { assistantId, durationMs, text }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    const phases = [...(assistant.phases ?? [])];
    const trimmed = text?.trim();
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "thought" && phase.pending) {
        phases[i] = {
          kind: "thought",
          durationMs,
          ...(phase.contentOffset !== undefined
            ? { contentOffset: phase.contentOffset }
            : {}),
          ...(trimmed ? { text: trimmed } : {}),
        };
        await ctx.db.patch(assistantId, {
          phases,
          updatedAt: Date.now(),
        });
        return;
      }
    }
  },
});

export const finalizeLastPendingMcp = internalMutation({
  args: {
    assistantId: v.id("messages"),
    server: v.optional(v.string()),
    tool: v.optional(v.string()),
    action: v.optional(v.string()),
    completed: v.optional(v.string()),
    ok: v.optional(v.boolean()),
    error: v.optional(v.string()),
    contentOffset: v.optional(v.number()),
  },
  handler: async (
    ctx,
    {
      assistantId,
      server,
      tool,
      action,
      completed,
      ok,
      error,
      contentOffset,
    },
  ) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    const phases = [...(assistant.phases ?? [])];
    const buildPhase = (offset: number | undefined) => ({
      kind: "mcp" as const,
      ...(server !== undefined ? { server } : {}),
      ...(tool !== undefined ? { tool } : {}),
      ...(action !== undefined ? { action } : {}),
      ...(completed !== undefined ? { completed } : {}),
      ...(ok !== undefined ? { ok } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(offset !== undefined ? { contentOffset: offset } : {}),
    });

    // Prefer the pending phase opened on tool-input-start; fall back to an
    // appended finalized phase when the provider delivered the call in one shot.
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "mcp" && phase.pending) {
        phases[i] = buildPhase(phase.contentOffset);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }

    phases.push(buildPhase(contentOffset));
    await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
  },
});

export const finalizeLastPendingSkill = internalMutation({
  args: {
    assistantId: v.id("messages"),
    name: v.optional(v.string()),
    ok: v.optional(v.boolean()),
    error: v.optional(v.string()),
    contentOffset: v.optional(v.number()),
  },
  handler: async (ctx, { assistantId, name, ok, error, contentOffset }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    const phases = [...(assistant.phases ?? [])];
    const buildPhase = (offset: number | undefined) => ({
      kind: "skill" as const,
      ...(name !== undefined ? { name } : {}),
      ...(ok !== undefined ? { ok } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(offset !== undefined ? { contentOffset: offset } : {}),
    });

    // Prefer the pending phase opened on tool-input-start; fall back to an
    // appended finalized phase when the provider delivered the call in one shot.
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "skill" && phase.pending) {
        phases[i] = buildPhase(phase.contentOffset);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }

    phases.push(buildPhase(contentOffset));
    await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
  },
});

// Settle a searchChatHistory call onto the message's pending `history` phase:
// just the query + how many past messages matched (the excerpts themselves
// only go to the model).
export const finalizeLastPendingHistory = internalMutation({
  args: {
    assistantId: v.id("messages"),
    query: v.optional(v.string()),
    matches: v.optional(v.number()),
    contentOffset: v.optional(v.number()),
  },
  handler: async (ctx, { assistantId, query, matches, contentOffset }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    const phases = [...(assistant.phases ?? [])];
    const buildPhase = (offset: number | undefined) => ({
      kind: "history" as const,
      ...(query !== undefined ? { query } : {}),
      ...(matches !== undefined ? { matches } : {}),
      ...(offset !== undefined ? { contentOffset: offset } : {}),
    });

    // Prefer the pending phase opened on tool-input-start; fall back to an
    // appended finalized phase when the provider delivered the call in one shot.
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "history" && phase.pending) {
        phases[i] = buildPhase(phase.contentOffset);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }

    phases.push(buildPhase(contentOffset));
    await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
  },
});

// Settle a suggestIntegrations call onto the message's pending
// `integrationSuggestion` phase. Only listing ids + name snapshots are stored;
// the card hydrates live branding and install state from the store.
export const finalizeLastPendingIntegrationSuggestion = internalMutation({
  args: {
    assistantId: v.id("messages"),
    query: v.optional(v.string()),
    items: v.array(
      v.object({
        integrationId: v.id("integrations"),
        name: v.string(),
      }),
    ),
    // Used only when no pending phase exists to inherit a position from.
    contentOffset: v.optional(v.number()),
  },
  handler: async (ctx, { assistantId, query, items, contentOffset }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    const phases = [...(assistant.phases ?? [])];
    const buildPhase = (offset: number | undefined) => ({
      kind: "integrationSuggestion" as const,
      ...(query !== undefined ? { query } : {}),
      items,
      ...(offset !== undefined ? { contentOffset: offset } : {}),
    });

    // Prefer the pending phase opened on tool-input-start; fall back to an
    // appended finalized phase when the provider delivered the call in one shot.
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "integrationSuggestion" && phase.pending) {
        phases[i] = buildPhase(phase.contentOffset);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }

    phases.push(buildPhase(contentOffset));
    await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
  },
});

// Settle an askUserQuestion call onto the message's pending `question` phase.
// An empty question list drops the phase instead — nothing renderable was
// asked, so no card and no composer morph.
export const finalizeLastPendingQuestion = internalMutation({
  args: {
    assistantId: v.id("messages"),
    questions: v.array(questionSpecValidator),
    // Used only when no pending phase exists to inherit a position from.
    contentOffset: v.optional(v.number()),
  },
  handler: async (ctx, { assistantId, questions, contentOffset }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    const phases = [...(assistant.phases ?? [])];
    const buildPhase = (offset: number | undefined) => ({
      kind: "question" as const,
      questions,
      ...(offset !== undefined ? { contentOffset: offset } : {}),
    });

    // Prefer the pending phase opened on tool-input-start; fall back to an
    // appended finalized phase when the provider delivered the call in one shot.
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "question" && phase.pending) {
        if (questions.length === 0) {
          phases.splice(i, 1);
        } else {
          phases[i] = buildPhase(phase.contentOffset);
        }
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }

    if (questions.length === 0) return;
    phases.push(buildPhase(contentOffset));
    await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
  },
});

// A suggestIntegrations call that surfaced nothing installable renders no
// card — drop the pending phase instead of finalizing an empty one.
export const dropLastPendingIntegrationSuggestion = internalMutation({
  args: {
    assistantId: v.id("messages"),
  },
  handler: async (ctx, { assistantId }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant?.phases) return;

    const phases = [...assistant.phases];
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "integrationSuggestion" && phase.pending) {
        phases.splice(i, 1);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }
  },
});

// Kicks off a background paint for a generateImage tool call: stamps the
// prompt onto the pending `image` phase opened on tool-input-start (or opens
// one when the provider delivered the call in one shot), then schedules the
// worker — atomically, so a stamped phase always has a job in flight and
// clearPendingPhases can tell an orphaned phase (no prompt) from a live one.
export const beginImageGeneration = internalMutation({
  args: {
    assistantId: v.id("messages"),
    threadId: v.id("threads"),
    userId: v.string(),
    prompt: v.string(),
    callIdx: v.number(),
    contentOffset: v.number(),
    // The stream this paint belongs to. A retry mints a fresh streamId, so the
    // worker can tell its reply is gone and quietly drop a stale paint instead
    // of splicing it into the new attempt.
    streamId: v.string(),
    // Idempotency key for the worker's usage deduction, minted from the stream
    // so a retried turn bills its own paint instead of colliding with the old one.
    billingKey: v.string(),
  },
  handler: async (
    ctx,
    {
      assistantId,
      threadId,
      userId,
      prompt,
      callIdx,
      contentOffset,
      streamId,
      billingKey,
    },
  ) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    const phases = [...(assistant.phases ?? [])];
    let stamped = false;
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "image" && phase.pending && !phase.prompt) {
        phases[i] = { ...phase, prompt };
        stamped = true;
        break;
      }
    }
    if (!stamped) {
      phases.push({ kind: "image", prompt, contentOffset, pending: true });
    }
    await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });

    await ctx.scheduler.runAfter(0, internal.imageWorker.paintImage, {
      assistantId,
      threadId,
      userId,
      prompt,
      callIdx,
      streamId,
      billingKey,
    });
  },
});

// Settles the `image` phase once its background paint resolves: the worker
// hands back the stored pictures' URLs (or an error) and this fills the
// matching pending phase. Matched by prompt first — parallel paints each have
// their own stamped phase — with last-pending and append fallbacks. Tolerant
// of a vanished reply: the job can outlive a retry, in which case the message
// carries a fresh streamId (or is gone entirely) and the stale paint is
// dropped instead of spliced into the new attempt.
export const finalizeLastPendingImage = internalMutation({
  args: {
    assistantId: v.id("messages"),
    prompt: v.optional(v.string()),
    count: v.optional(v.number()),
    images: v.optional(v.array(v.string())),
    ok: v.optional(v.boolean()),
    error: v.optional(v.string()),
    contentOffset: v.optional(v.number()),
    // When set, the paint only lands if the message still belongs to this
    // stream — a retry resets phases and mints a new streamId.
    expectedStreamId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { assistantId, prompt, count, images, ok, error, contentOffset, expectedStreamId },
  ) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      return;
    }
    if (expectedStreamId !== undefined && assistant.streamId !== expectedStreamId) {
      return;
    }

    const phases = [...(assistant.phases ?? [])];
    const buildPhase = (offset: number | undefined) => ({
      kind: "image" as const,
      ...(prompt !== undefined ? { prompt } : {}),
      ...(count !== undefined ? { count } : {}),
      ...(images !== undefined ? { images } : {}),
      ...(ok !== undefined ? { ok } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(offset !== undefined ? { contentOffset: offset } : {}),
    });

    const settle = async (index: number) => {
      phases[index] = buildPhase(phases[index].contentOffset);
      await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
    };

    if (prompt !== undefined) {
      for (let i = phases.length - 1; i >= 0; i -= 1) {
        const phase = phases[i];
        if (phase.kind === "image" && phase.pending && phase.prompt === prompt) {
          return await settle(i);
        }
      }
    }

    for (let i = phases.length - 1; i >= 0; i -= 1) {
      if (phases[i].kind === "image" && phases[i].pending) {
        return await settle(i);
      }
    }

    phases.push(buildPhase(contentOffset));
    await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
  },
});

// The pending `mcp` chip opens on tool-input-start, before the call's input
// exists, so it starts anonymous. Once the input is parsed this stamps the
// integration + tool onto the still-pending phase, letting the client show
// the integration's branding and the developer's action phrase mid-run.
export const describeLastPendingMcp = internalMutation({
  args: {
    assistantId: v.id("messages"),
    server: v.string(),
    tool: v.optional(v.string()),
    action: v.optional(v.string()),
    completed: v.optional(v.string()),
  },
  handler: async (ctx, { assistantId, server, tool, action, completed }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      return;
    }

    const phases = [...(assistant.phases ?? [])];
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "mcp" && phase.pending && !phase.server) {
        phases[i] = {
          ...phase,
          server,
          ...(tool !== undefined ? { tool } : {}),
          ...(action !== undefined ? { action } : {}),
          ...(completed !== undefined ? { completed } : {}),
        };
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }
  },
});

export const finalizeLastPendingDocument = internalMutation({
  args: {
    assistantId: v.id("messages"),
    op: v.union(v.literal("create"), v.literal("edit")),
    documentId: v.id("documents"),
    title: v.optional(v.string()),
    editCount: v.optional(v.number()),
    ok: v.optional(v.boolean()),
    error: v.optional(v.string()),
    contentOffset: v.optional(v.number()),
  },
  handler: async (ctx, { assistantId, contentOffset, ...doc }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    const phases = [...(assistant.phases ?? [])];
    const buildPhase = (offset: number | undefined) => ({
      kind: "document" as const,
      op: doc.op,
      documentId: doc.documentId,
      ...(doc.title !== undefined ? { title: doc.title } : {}),
      ...(doc.editCount !== undefined ? { editCount: doc.editCount } : {}),
      ...(doc.ok !== undefined ? { ok: doc.ok } : {}),
      ...(doc.error !== undefined ? { error: doc.error } : {}),
      ...(offset !== undefined ? { contentOffset: offset } : {}),
    });

    // Prefer the pending phase for this exact document. Older rows may have a
    // pending create phase without an id, so keep that fallback, but never add a
    // second finalized card for a document phase that's already present.
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (
        phase.kind === "document" &&
        phase.pending &&
        phase.documentId === doc.documentId
      ) {
        phases[i] = buildPhase(phase.contentOffset);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }

    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (
        phase.kind === "document" &&
        phase.pending &&
        phase.op === doc.op &&
        phase.documentId === undefined
      ) {
        phases[i] = buildPhase(phase.contentOffset);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }

    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (
        phase.kind === "document" &&
        !phase.pending &&
        phase.documentId === doc.documentId &&
        phase.op === doc.op
      ) {
        phases[i] = buildPhase(phase.contentOffset ?? contentOffset);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }

    phases.push(buildPhase(contentOffset));
    await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
  },
});

// Remove the last pending `document` phase of a given op. Used when an edit
// lands nothing (every anchor missed): rather than finalizing a red "couldn't
// apply" card, we just drop the pending card so the failure never shows in the
// chat — the model still gets the misses back in the tool result to retry.
export const dropPendingDocumentPhase = internalMutation({
  args: {
    assistantId: v.id("messages"),
    op: v.union(v.literal("create"), v.literal("edit")),
  },
  handler: async (ctx, { assistantId, op }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant?.phases) return;

    const phases = [...assistant.phases];
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "document" && phase.pending && phase.op === op) {
        phases.splice(i, 1);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }
  },
});

// Finalize an HTML artifact onto the message's pending `html` phase. Inline and
// full, create and edit all share this; matched by op (+ mode when both carry
// one) so a same-turn inline-create and full-create don't clobber each other,
// while an edit (whose pending phase has no mode yet) matches any op:"edit".
export const finalizeLastPendingHtml = internalMutation({
  args: {
    assistantId: v.id("messages"),
    op: v.union(v.literal("create"), v.literal("edit")),
    mode: v.union(v.literal("inline"), v.literal("full")),
    htmlId: v.id("htmlArtifacts"),
    title: v.optional(v.string()),
    editCount: v.optional(v.number()),
    ok: v.optional(v.boolean()),
    error: v.optional(v.string()),
    contentOffset: v.optional(v.number()),
  },
  handler: async (ctx, { assistantId, contentOffset, ...art }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant) {
      throw new Error("Assistant message not found");
    }

    const phases = [...(assistant.phases ?? [])];
    const buildPhase = (offset: number | undefined) => ({
      kind: "html" as const,
      mode: art.mode,
      op: art.op,
      htmlId: art.htmlId,
      ...(art.title !== undefined ? { title: art.title } : {}),
      ...(art.editCount !== undefined ? { editCount: art.editCount } : {}),
      ...(art.ok !== undefined ? { ok: art.ok } : {}),
      ...(art.error !== undefined ? { error: art.error } : {}),
      ...(offset !== undefined ? { contentOffset: offset } : {}),
    });

    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (
        phase.kind === "html" &&
        phase.pending &&
        phase.op === art.op &&
        (phase.htmlId === undefined || phase.htmlId === art.htmlId) &&
        (phase.mode === undefined || phase.mode === art.mode)
      ) {
        phases[i] = buildPhase(phase.contentOffset);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }

    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (
        phase.kind === "html" &&
        !phase.pending &&
        phase.htmlId === art.htmlId &&
        phase.op === art.op &&
        (phase.mode === undefined || phase.mode === art.mode)
      ) {
        phases[i] = buildPhase(phase.contentOffset ?? contentOffset);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }

    phases.push(buildPhase(contentOffset));
    await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
  },
});

// Attach the row id to the streaming `html` phase opened on tool-input-start.
// The pending phase is added the instant the tool starts (so the "Drawing a
// visualization" / "Building the page" card shows immediately), and the row id
// round-trips a beat later — this fills it in so the card can latch onto the
// live row and stream.
export const attachStreamingHtmlId = internalMutation({
  args: {
    assistantId: v.id("messages"),
    htmlId: v.id("htmlArtifacts"),
    mode: v.union(v.literal("inline"), v.literal("full")),
  },
  handler: async (ctx, { assistantId, htmlId, mode }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant?.phases) return;

    const phases = [...assistant.phases];
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (
        phase.kind === "html" &&
        phase.pending &&
        phase.op === "create" &&
        phase.mode === mode &&
        !phase.htmlId
      ) {
        phases[i] = { ...phase, htmlId };
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }
  },
});

/**
 * Move a streaming artifact from an inline card to the side panel mid-write.
 *
 * Only react artifacts need this: they declare `mode` inside the tool input,
 * so the row has to be opened before it's known. Patches the row and its
 * pending phase together, so the card and the panel never disagree about where
 * the thing is supposed to appear.
 */
export const promoteStreamingArtifactToFull = internalMutation({
  args: {
    assistantId: v.id("messages"),
    htmlId: v.id("htmlArtifacts"),
  },
  handler: async (ctx, { assistantId, htmlId }) => {
    const row = await ctx.db.get(htmlId);
    if (row && row.kind !== "full") {
      await ctx.db.patch(htmlId, { kind: "full" });
    }

    const assistant = await ctx.db.get(assistantId);
    if (!assistant?.phases) return;
    const phases = [...assistant.phases];
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "html" && phase.pending && phase.htmlId === htmlId) {
        if (phase.mode === "full") return;
        phases[i] = { ...phase, mode: "full" };
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }
  },
});

// Remove the last pending `html` phase of a given op. Used when an editHtml
// pass lands nothing (every anchor missed): drop the pending card so no failure
// shows in chat — the model still gets the misses back to retry.
export const dropPendingHtmlPhase = internalMutation({
  args: {
    assistantId: v.id("messages"),
    op: v.union(v.literal("create"), v.literal("edit")),
  },
  handler: async (ctx, { assistantId, op }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant?.phases) return;

    const phases = [...assistant.phases];
    for (let i = phases.length - 1; i >= 0; i -= 1) {
      const phase = phases[i];
      if (phase.kind === "html" && phase.pending && phase.op === op) {
        phases.splice(i, 1);
        await ctx.db.patch(assistantId, { phases, updatedAt: Date.now() });
        return;
      }
    }
  },
});

// Drop any phases still marked pending — used when a generation is stopped or
// errors mid-thought/mid-search so the UI doesn't show a stuck indicator.
// Pending `image` phases WITH a prompt survive: the prompt is stamped in the
// same transaction that schedules the background paint, so those have a worker
// in flight that will land the picture (or an error) even after the turn ends.
// A pending image phase without a prompt never got its job scheduled — sweep it.
// (The filter itself lives in validators.ts so the stream watchdog shares it.)
export const clearPendingPhases = internalMutation({
  args: {
    assistantId: v.id("messages"),
  },
  handler: async (ctx, { assistantId }) => {
    const assistant = await ctx.db.get(assistantId);
    if (!assistant?.phases) return;

    const phases = settledPhases(assistant.phases);
    if (!phases || phases === assistant.phases) return;

    await ctx.db.patch(assistantId, {
      phases,
      updatedAt: Date.now(),
    });
  },
});

// Liveness stamp for the watchdog (streamWatchdog.ts): the stream handler
// beats every ~25s while a turn is in flight. Quietly refuses to stamp a
// message that already settled, so a racing terminal write always wins.
export const recordAssistantHeartbeat = internalMutation({
  args: {
    assistantId: v.id("messages"),
  },
  handler: async (ctx, { assistantId }) => {
    const message = await ctx.db.get(assistantId);
    if (!message) return;
    if (
      message.status !== "thinking" &&
      message.status !== "searching" &&
      message.status !== "streaming"
    ) {
      return;
    }
    await ctx.db.patch(assistantId, { heartbeatAt: Date.now() });
  },
});

export const streamAssistant = httpAction(handleStreamAssistant);

// The server-driven turn: scheduled with runAfter(0) by sendUserMessage and
// the retry/edit mutations (messages.ts), so generation survives whatever
// happens to the tab that asked for it. The heartbeat + watchdog pair
// (streamWatchdog.ts) still backstops this action dying mid-flight.
export const runAssistantTurn = internalAction({
  args: {
    streamId: StreamIdValidator,
    userId: v.string(),
    userName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await runAssistantTurnHandler(ctx, args);
  },
});

// Deferred per-turn bookkeeping (analytics, billing, memory, compaction),
// scheduled by the stream writer the moment the reply settles so the HTTP
// action can return without waiting on these external round trips. See
// inference/finalize.ts for why each step is safe to run off the critical path.
export const finalizeAssistantTurn = internalAction({
  args: finalizeAssistantTurnArgs,
  handler: finalizeAssistantTurnHandler,
});

export const setThreadTitle = internalMutation({
  args: {
    threadId: v.id("threads"),
    title: v.string(),
  },
  handler: async (ctx, { threadId, title }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread) return;
    await ctx.db.patch(threadId, {
      title,
      titleStatus: "ready",
      updatedAt: Date.now(),
    });
  },
});

// Regeneration's landing pad. The title is optional on purpose: when the model
// couldn't be reached the thread keeps the name it had, and `updatedAt` stays
// put either way so a re-title never shuffles the sidebar under the cursor.
export const finishTitleRegeneration = internalMutation({
  args: {
    threadId: v.id("threads"),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { threadId, title }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread) return;
    await ctx.db.patch(threadId, {
      ...(title ? { title } : {}),
      titleStatus: "ready",
    });
  },
});

export const generateThreadTitle = internalAction({
  args: {
    threadId: v.id("threads"),
    prompt: v.string(),
  },
  handler: async (ctx, { threadId, prompt }) => {
    await generateThreadTitleForPrompt({ ctx, threadId, prompt });
  },
});

// Scheduled by threads.regenerateTitle — the user asking for a better name once
// the thread has some conversation in it. `userId` rides along because
// scheduled actions run without an auth identity.
export const regenerateThreadTitle = internalAction({
  args: {
    threadId: v.id("threads"),
    userId: v.string(),
  },
  handler: async (ctx, { threadId, userId }) => {
    await regenerateThreadTitleFromThread({ ctx, threadId, userId });
  },
});

export const streamAssistantOptions = httpAction(async () => {
  return streamAssistantOptionsResponse();
});
