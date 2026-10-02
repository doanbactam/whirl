import type { FunctionReference } from "convex/server";
import { makeFunctionReference } from "convex/server";
import { useConvex, useMutation, useQuery_experimental } from "convex/react";
import { useEffect, useMemo } from "react";

import type { Thread } from "~/data/threads";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

type QueryStatus = "pending" | "success" | "error";
type QueryWithErrorResult<T> = {
  data: T | undefined;
  error: Error | undefined;
  status: QueryStatus;
};

function useQueryWithError<T>(
  query: FunctionReference<"query">,
  args: Record<string, unknown> | "skip",
): QueryWithErrorResult<T> {
  return (
    useQuery_experimental as unknown as (input: {
      query: FunctionReference<"query">;
      args: Record<string, unknown> | "skip";
      throwOnError: boolean;
    }) => QueryWithErrorResult<T>
  )({ query, args, throwOnError: false });
}

export type Attachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  storageId?: string;
  url?: string;
  data?: string;
  text?: string;
  skippedReason?: string;
};

export type MessageStatus =
  | "thinking"
  | "searching"
  | "streaming"
  | "complete"
  | "stopped"
  | "error";

export type ModelKey = "Auto" | "Fast" | "Basic" | "Max" | "Image";

/**
 * An integration the user @mentioned on a message. `logoUrl`/`iconSvg` are
 * display-only: hydrated by the server on reads, carried along on sends so
 * optimistic chips have branding, and stripped before the mutation.
 */
export type IntegrationMentionRef = {
  serverId: string;
  name: string;
  logoUrl?: string | null;
  iconSvg?: string;
};

/**
 * A skill the user @mentioned on a message — same deal as integration
 * mentions, keyed by the user's install row.
 */
export type SkillMentionRef = {
  installId: string;
  name: string;
  logoUrl?: string | null;
  iconSvg?: string;
};

export type SendOptions = {
  thinking?: boolean;
  search?: boolean;
  model?: ModelKey;
  integrations?: IntegrationMentionRef[];
  skills?: SkillMentionRef[];
};

export type SearchSource = {
  url: string;
  title: string;
  author?: string;
  publishedDate?: string;
};

export type Phase =
  | {
      kind: "thought";
      durationMs: number;
      contentOffset?: number;
      text?: string;
      pending?: boolean;
    }
  | {
      kind: "search";
      sources: number;
      items?: SearchSource[];
      contentOffset?: number;
      query?: string;
      pending?: boolean;
    }
  | {
      kind: "fetch";
      sources: number;
      items?: SearchSource[];
      contentOffset?: number;
      pending?: boolean;
    }
  | {
      kind: "calc";
      /** Legacy "result card" flag on old messages; ignored by the UI. */
      visible?: boolean;
      expression?: string;
      result?: string;
      label?: string;
      expressionTex?: string;
      resultTex?: string;
      needsLatex?: boolean;
      error?: string;
      items?: CalcItem[];
      contentOffset?: number;
      pending?: boolean;
    }
  | {
      kind: "weather";
      place?: string;
      approximate?: boolean;
      latitude?: number;
      longitude?: number;
      timezone?: string;
      tempUnit?: "C" | "F";
      windUnit?: "km/h" | "mph";
      temp?: number;
      apparentTemp?: number;
      humidity?: number;
      windSpeed?: number;
      code?: number;
      isDay?: boolean;
      precipitation?: number;
      hourly?: WeatherHour[];
      daily?: WeatherDay[];
      error?: string;
      contentOffset?: number;
      pending?: boolean;
    }
  | {
      kind: "mcp";
      server?: string;
      tool?: string;
      ok?: boolean;
      error?: string;
      contentOffset?: number;
      pending?: boolean;
    }
  // A skill (an installed instruction pack from the store) the model pulled
  // in via load_skill: a "Learning …" chip while the text is fetched, then a
  // quiet "Learned <name>" once it lands.
  | {
      kind: "skill";
      name?: string;
      ok?: boolean;
      error?: string;
      contentOffset?: number;
      pending?: boolean;
    }
  // A rummage through the user's past chats via searchChatHistory: a chip
  // while the archives are being searched, then a quiet "Dug through your
  // chats" once the query + match count land. Excerpts go to the model only.
  | {
      kind: "history";
      query?: string;
      matches?: number;
      contentOffset?: number;
      pending?: boolean;
    }
  // Store listings whirl surfaced via suggestIntegrations: a chip while the
  // store is being searched, then an inline card of install buttons. Only ids
  // + name snapshots live here — the card hydrates live branding and install
  // state from the store, so installing flips it without touching the message.
  | {
      kind: "integrationSuggestion";
      query?: string;
      items?: { integrationId: string; name: string }[];
      contentOffset?: number;
      pending?: boolean;
    }
  | {
      kind: "document";
      op?: "create" | "edit";
      documentId?: string;
      title?: string;
      editCount?: number;
      ok?: boolean;
      error?: string;
      contentOffset?: number;
      pending?: boolean;
    }
  | {
      kind: "html";
      mode?: "inline" | "full";
      op?: "create" | "edit";
      htmlId?: string;
      title?: string;
      editCount?: number;
      ok?: boolean;
      error?: string;
      contentOffset?: number;
      pending?: boolean;
    }
  // An image whirl painted mid-reply via the generateImage tool. Painted in
  // the background: the phase shows as an inline shimmer card while pending,
  // then the worker lands the stored pictures' URLs in `images` and the card
  // morphs into the real thing. Legacy rows have no `images` — those pictures
  // live in the prose as markdown and the phase is just a quiet chip.
  | {
      kind: "image";
      prompt?: string;
      count?: number;
      images?: string[];
      ok?: boolean;
      error?: string;
      contentOffset?: number;
      pending?: boolean;
    }
  // Legacy: the retired generative-UI feature; kept so old messages type-check.
  | {
      kind: "ui";
      title?: string;
      spec?: unknown;
      error?: string;
      contentOffset?: number;
      pending?: boolean;
    };

export type WeatherHour = {
  time: string;
  temp: number;
  code: number;
  precipProb?: number;
};

export type WeatherDay = {
  date: string;
  code: number;
  max: number;
  min: number;
  precipProb?: number;
  sunrise?: string;
  sunset?: string;
};

export type CalcItem = {
  expression: string;
  result?: string;
  label?: string;
  expressionTex?: string;
  resultTex?: string;
  needsLatex?: boolean;
  error?: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  attachments?: Attachment[];
  /** Integrations the user @mentioned on this message, with branding. */
  integrations?: IntegrationMentionRef[];
  /** Skills the user @mentioned on this message, with branding. */
  skills?: SkillMentionRef[];
  status?: MessageStatus;
  phases?: Phase[];
  streamId?: string;
  model?: ModelKey;
  thinking?: boolean;
  search?: boolean;
  /** Legacy local memory rows this assistant turn saved (drives the indicator). */
  addedMemoryIds?: string[];
  /** Output tokens for this response (reasoning included); shown via "Show stats". */
  outputTokens?: number;
  /** Wall-clock time the response took, in ms; shown via "Show stats". */
  durationMs?: number;
  /** Raw provider cost (USD) of this response; shown as a share of the plan's usage. */
  usageCost?: number;
};

type AssistantUpdateArgs = {
  threadId: string;
  messageId: string;
  content?: string;
  status?: MessageStatus;
  phases?: Phase[];
};

type AssistantStreamDriver = {
  prepareAuthToken?: () => Promise<string | null>;
  start: (
    streamId: string,
    authTokenPromise?: Promise<string | null>,
  ) => void;
};

const EMPTY: Message[] = [];
export const drivenStreamIds = new Set<string>();
const listThreadMessages = makeFunctionReference<"query">(
  "messages:listForThread",
);
export const getStreamBodyRef = makeFunctionReference<"query">(
  "messages:getStreamBody",
);
const sendUserMessageRef = makeFunctionReference<"mutation">(
  "messages:sendUserMessage",
);
const generateAttachmentUploadUrlRef = makeFunctionReference<"mutation">(
  "messages:generateAttachmentUploadUrl",
);
const updateUserMessageRef = makeFunctionReference<"mutation">(
  "messages:updateUserMessage",
);
const retryFromUserMessageRef = makeFunctionReference<"mutation">(
  "messages:prepareAssistantRetryFromUser",
);
const resetAssistantMessageRef = makeFunctionReference<"mutation">(
  "messages:resetAssistantMessage",
);
const updateAssistantMessageRef = makeFunctionReference<"mutation">(
  "messages:updateAssistantMessage",
);
const branchThreadRef = makeFunctionReference<"mutation">(
  "threads:branchThread",
);
const rollbackToMessageRef = makeFunctionReference<"mutation">(
  "threads:rollbackToMessage",
);
const PREWARM_THREAD_COUNT = 20;
const PREWARM_SUBSCRIPTION_MS = 5 * 60 * 1000;

/** Drop client-only attachment fields the send mutation doesn't accept. */
export function sanitizeAttachments(attachments?: Attachment[]) {
  return attachments?.map(
    ({ id, name, size, type, storageId, url, text, skippedReason }) => ({
      id,
      name,
      size,
      type,
      storageId,
      ...(storageId ? {} : { url }),
      ...(text !== undefined ? { text } : {}),
      skippedReason,
    }),
  );
}

export function useThreadMessages(threadId: string | undefined): {
  messages: Message[];
  isLoading: boolean;
  error: Error | null;
} {
  const convex = useConvex();
  const { data: messages, error, status } = useQueryWithError<Message[]>(
    listThreadMessages,
    threadId ? { threadId } : "skip",
  );

  useEffect(() => {
    if (!threadId || status !== "success") return;
    convex.prewarmQuery({
      query: listThreadMessages,
      args: { threadId },
      extendSubscriptionFor: PREWARM_SUBSCRIPTION_MS,
    });
  }, [convex, threadId, status]);

  return {
    messages: messages ?? EMPTY,
    isLoading: threadId !== undefined && status === "pending",
    error: error ?? null,
  };
}

export function usePrewarmRecentThreadMessages(threads: Thread[]) {
  const convex = useConvex();
  const threadIds = useMemo(
    () =>
      threads
        .slice(0, PREWARM_THREAD_COUNT)
        .map((thread) => thread.id)
        .join(","),
    [threads],
  );

  useEffect(() => {
    if (!threadIds) return;

    for (const threadId of threadIds.split(",")) {
      convex.prewarmQuery({
        query: listThreadMessages,
        args: { threadId },
        extendSubscriptionFor: PREWARM_SUBSCRIPTION_MS,
      });
    }
  }, [convex, threadIds]);
}

export function useMessageActions(
  threadId: string | undefined,
  incognito = false,
  streamDriver?: AssistantStreamDriver,
) {
  const capture = useCapture();
  const createMessage = useMutation(sendUserMessageRef);
  const generateAttachmentUploadUrl = useMutation(
    generateAttachmentUploadUrlRef,
  );
  const updateUserMessage = useMutation(updateUserMessageRef);
  const retryFromUserMessage = useMutation(retryFromUserMessageRef);
  const resetAssistantMessage = useMutation(resetAssistantMessageRef);
  const branchThread = useMutation(branchThreadRef);
  // Rollback drops the tail of the thread instantly on screen — the server
  // deletion confirms (or restores) it when the mutation settles.
  const rollbackThread = useMutation(rollbackToMessageRef).withOptimisticUpdate(
    (localStore, args) => {
      const a = args as { threadId: string; messageId: string };
      const existing = localStore.getQuery(listThreadMessages, {
        threadId: a.threadId,
      }) as Message[] | undefined;
      if (!existing) return;
      const checkpointIndex = existing.findIndex((m) => m.id === a.messageId);
      if (checkpointIndex === -1) return;
      localStore.setQuery(
        listThreadMessages,
        { threadId: a.threadId },
        existing.slice(0, checkpointIndex + 1),
      );
    },
  );
  const updateAssistantMessage = useMutation(
    updateAssistantMessageRef,
  ).withOptimisticUpdate((localStore, args) => {
    const a = args as AssistantUpdateArgs;
    const existing = localStore.getQuery(listThreadMessages, {
      threadId: a.threadId,
    }) as Message[] | undefined;
    if (!existing) return;
    const updated = existing.map((m) => {
      if (m.id !== a.messageId) return m;
      return {
        ...m,
        ...(a.content !== undefined ? { content: a.content } : {}),
        ...(a.status !== undefined ? { status: a.status } : {}),
        ...(a.phases !== undefined ? { phases: a.phases } : {}),
      };
    });
    localStore.setQuery(
      listThreadMessages,
      { threadId: a.threadId },
      updated,
    );
  });

  const prepareStreamAuthToken = () =>
    streamDriver?.prepareAuthToken?.().catch((error) => {
      console.error("Failed to prepare assistant stream auth token", error);
      return null;
    });

  const startAssistantStream = (
    streamId: string,
    authTokenPromise?: Promise<string | null>,
  ) => {
    drivenStreamIds.add(streamId);
    streamDriver?.start(streamId, authTokenPromise);
  };

  return {
    async getAttachmentUploadUrl() {
      return (await generateAttachmentUploadUrl({})) as string;
    },

    async sendUserMessage(
      content: string,
      attachments?: Attachment[],
      options?: SendOptions,
    ) {
      const authTokenPromise = prepareStreamAuthToken();
      const mentionedIntegrations = options?.integrations ?? [];
      const mentionedSkills = options?.skills ?? [];
      const result = (await createMessage({
        threadId,
        content,
        attachments: sanitizeAttachments(attachments),
        // Branding fields are client-side sugar — the mutation only wants the
        // reference, and it re-derives the name from the install row anyway.
        ...(mentionedIntegrations.length > 0
          ? {
              integrations: mentionedIntegrations.map(({ serverId, name }) => ({
                serverId,
                name,
              })),
            }
          : {}),
        ...(mentionedSkills.length > 0
          ? {
              skills: mentionedSkills.map(({ installId, name }) => ({
                installId,
                name,
              })),
            }
          : {}),
        options: {
          thinking: options?.thinking ?? false,
          search: options?.search ?? false,
          model: options?.model ?? "Auto",
        },
        ...(incognito ? { incognito: true } : {}),
      })) as {
        threadId: string;
        userMessageId: string;
        assistantId: string;
        streamId: string;
      };

      startAssistantStream(result.streamId, authTokenPromise);

      capture(ANALYTICS_EVENTS.messageSent, {
        model: options?.model ?? "Auto",
        thinking: options?.thinking ?? false,
        search: options?.search ?? false,
        has_attachments: Boolean(attachments?.length),
        attachment_count: attachments?.length ?? 0,
        integration_mention_count: mentionedIntegrations.length,
        integration_mentions: mentionedIntegrations.map((m) => m.name),
        skill_mention_count: mentionedSkills.length,
        skill_mentions: mentionedSkills.map((m) => m.name),
        // A brand-new thread had no id when the send started.
        new_thread: !threadId,
        incognito,
      });

      return result;
    },

    async updateMessage(messageId: string, content: string) {
      if (!threadId) return;

      const authTokenPromise = prepareStreamAuthToken();
      await updateUserMessage({
        threadId,
        messageId,
        content,
      });
      capture(ANALYTICS_EVENTS.messageEdited, {
        content_length: content.length,
      });

      // Editing a message resends it — regenerate the reply from this point.
      const result = (await retryFromUserMessage({
        threadId,
        userMessageId: messageId,
      })) as { assistantId: string; streamId: string };
      startAssistantStream(result.streamId, authTokenPromise);
      return result;
    },

    async retryUserMessage(messageId: string) {
      if (!threadId) return;

      const authTokenPromise = prepareStreamAuthToken();
      const result = (await retryFromUserMessage({
        threadId,
        userMessageId: messageId,
      })) as { assistantId: string; streamId: string };

      startAssistantStream(result.streamId, authTokenPromise);
      capture(ANALYTICS_EVENTS.messageRetried, { from: "user" });
      return result;
    },

    async retryAssistantMessage(messageId: string) {
      if (!threadId) return;

      const authTokenPromise = prepareStreamAuthToken();
      const result = (await resetAssistantMessage({
        threadId,
        messageId,
      })) as { assistantId: string; streamId: string };

      startAssistantStream(result.streamId, authTokenPromise);
      capture(ANALYTICS_EVENTS.messageRetried, { from: "assistant" });
      return result;
    },

    async branchFromMessage(messageId: string) {
      if (!threadId) return;

      const result = (await branchThread({
        threadId,
        messageId,
      })) as { threadId: string; messageCount: number };

      capture(ANALYTICS_EVENTS.threadBranched, {
        source_thread_id: threadId,
        message_count: result.messageCount,
      });
      return result;
    },

    async rollbackToMessage(messageId: string) {
      if (!threadId) return;

      const result = (await rollbackThread({
        threadId,
        messageId,
      })) as { deleted: number };

      capture(ANALYTICS_EVENTS.threadRolledBack, {
        thread_id: threadId,
        deleted_count: result.deleted,
      });
      return result;
    },

    stopAssistant(messages: Message[]) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (
          message.role === "assistant" &&
          (message.status === "thinking" ||
            message.status === "searching" ||
            message.status === "streaming")
        ) {
          if (threadId) {
            void updateAssistantMessage({
              threadId,
              messageId: message.id,
              status: "stopped",
            });
            capture(ANALYTICS_EVENTS.generationStopped, {
              model: message.model ?? "Auto",
            });
          }
          return;
        }
      }
    },
  };
}

export function isGenerating(messages: Message[]) {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      (message.status === "thinking" ||
        message.status === "searching" ||
        message.status === "streaming"),
  );
}
