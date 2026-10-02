import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@clerk/tanstack-react-start";
import { useQuery } from "convex/react";
import type { StreamBody } from "@convex-dev/persistent-text-streaming";
import { Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  MessageScroller,
  useMessageScroller,
  useMessageScrollerScrollable,
} from "@shadcn/react/message-scroller";
import { AnimatePresence, motion } from "motion/react";
import { IconAlertTriangle, IconChevronDown, IconReload } from "@tabler/icons-react";

import { CompactionDivider } from "~/components/compaction-divider";
import { Composer, COMPOSER_GLASS_CONTROL } from "~/components/composer";
import { DepthButton } from "~/components/depth-button";
import { HomeFooter } from "~/components/home-footer";
import { Spinner } from "~/components/spinner";
import { MessageBubble } from "~/components/message-bubble";
import { QuoteSelectionPopover } from "~/components/quote-selection";
import { ThreadToolbar } from "~/components/thread-toolbar";
import { IncognitoToggle } from "~/components/incognito-toggle";
import { ThreadWidgetAnimationProvider } from "~/components/thread-widget-animation";
import { useAutoScrollPref } from "~/lib/auto-scroll";
import { useIncognito } from "~/lib/incognito";
import {
  COMPOSER_CLEARANCE_CLASS,
  useComposerClearance,
} from "~/lib/use-composer-clearance";
import { showToast } from "~/data/toasts";
import {
  isGenerating as computeIsGenerating,
  drivenStreamIds,
  getStreamBodyRef,
  useMessageActions,
  usePrewarmRecentThreadMessages,
  useThreadMessages,
  type Attachment,
  type IntegrationMentionRef,
  type Message,
  type ModelKey,
} from "~/data/messages";
import {
  clearLiveAssistantStream,
  startLiveAssistantStream,
  useLiveAssistantStream,
} from "~/data/live-assistant-streams";
import { useThreadActions, useThreads } from "~/data/threads";
import { useCustomer } from "autumn-js/react";
import { convexHttpOrigin } from "~/lib/convex-url";
import { useAuthGate } from "~/lib/auth-gate";
import { useMinMd } from "~/lib/use-media";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

const CHAT_SCROLL_EDGE_THRESHOLD_PX = 128;
const CHAT_SCROLL_MARGIN_PX = 56;
const CHAT_SCROLL_PREVIOUS_ITEM_PEEK_PX = 72;

export function ComposerLayout() {
  const { getToken, isLoaded } = useAuth();
  const { requireAuth } = useAuthGate();
  const location = useLocation();
  const navigate = useNavigate();
  const minMd = useMinMd();
  const incognito = useIncognito();
  const isThread = location.pathname.startsWith("/thread/");
  const routeThreadId = isThread
    ? location.pathname.slice("/thread/".length)
    : null;
  // In incognito we drive the chat from the ephemeral thread held in context —
  // never the URL. The address bar stays on "/" so nothing ever routes to (or
  // bookmarks) a thread that's about to be deleted.
  const threadId = incognito.enabled ? incognito.threadId : routeThreadId;
  // True once there's a conversation to show: a real routed thread, or an
  // incognito thread the first message has created.
  const inThreadView = incognito.enabled
    ? Boolean(incognito.threadId)
    : isThread;
  const threads = useThreads();
  usePrewarmRecentThreadMessages(threads);
  const assistantStreamUrl = useMemo(
    () =>
      new URL(
        "/assistant-stream",
        convexHttpOrigin() || "http://localhost",
      ),
    [],
  );
  const assistantStreamDriver = useMemo(
    () => ({
      prepareAuthToken: () => getToken({ template: "convex" }),
      start: (
        streamId: string,
        authTokenPromise?: Promise<string | null>,
      ) =>
        startLiveAssistantStream({
          streamId,
          streamUrl: assistantStreamUrl,
          authTokenPromise,
          getAuthToken: () => getToken({ template: "convex" }),
        }),
    }),
    [assistantStreamUrl, getToken],
  );

  const {
    messages: rawMessages,
    isLoading: messagesLoading,
    error: messagesError,
  } = useThreadMessages(threadId ?? undefined);
  const [pendingSend, setPendingSend] = useState<{
    threadId: string;
    messages: Message[];
  } | null>(null);
  const messages = useMemo<Message[]>(() => {
    if (!threadId || !pendingSend || pendingSend.threadId !== threadId) {
      return rawMessages;
    }
    const rawIds = new Set(rawMessages.map((m) => m.id));
    const missing = pendingSend.messages.filter((m) => !rawIds.has(m.id));
    if (missing.length === 0) {
      return rawMessages;
    }
    return [...rawMessages, ...missing].sort((a, b) => a.createdAt - b.createdAt);
  }, [rawMessages, pendingSend, threadId]);
  const showSkeleton = Boolean(threadId) && messagesLoading && messages.length === 0;
  const showLoadError =
    Boolean(threadId) && Boolean(messagesError) && messages.length === 0;

  useEffect(() => {
    if (!pendingSend) return;
    if (pendingSend.threadId !== threadId) return;
    const rawIds = new Set(rawMessages.map((m) => m.id));
    if (pendingSend.messages.every((m) => rawIds.has(m.id))) {
      setPendingSend(null);
    }
  }, [pendingSend, threadId, rawMessages]);

  const currentThread = threadId
    ? threads.find((t) => t.id === threadId)
    : null;

  // Every attachment sent in the thread, flattened from its messages — the
  // toolbar's file menu lists these alongside whirl-authored artifacts.
  const threadAttachments = useMemo(() => {
    const items: Attachment[] = [];
    for (const m of messages) {
      if (m.attachments?.length) items.push(...m.attachments);
    }
    return items;
  }, [messages]);

  // Map of message id -> compaction timestamp, so we can render a divider at
  // every point the thread was compacted (supports multiple compactions).
  const compactionMarkers = useMemo(() => {
    const map = new Map<string, number>();
    if (currentThread?.compactionMarkers?.length) {
      for (const mk of currentThread.compactionMarkers) {
        map.set(mk.messageId, mk.createdAt);
      }
    } else if (
      currentThread?.compactionBoundary &&
      currentThread.compactionUpdatedAt != null
    ) {
      // Legacy threads compacted before markers existed: show the single point.
      map.set(currentThread.compactionBoundary, currentThread.compactionUpdatedAt);
    }
    return map;
  }, [
    currentThread?.compactionMarkers,
    currentThread?.compactionBoundary,
    currentThread?.compactionUpdatedAt,
  ]);

  useEffect(() => {
    document.title = incognito.enabled
      ? "Incognito · Whirl"
      : currentThread?.title && currentThread.titleStatus !== "generating"
        ? `${currentThread.title} - Whirl`
        : "Whirl";
  }, [currentThread?.title, currentThread?.titleStatus, incognito.enabled]);
  const {
    branchFromMessage,
    getAttachmentUploadUrl,
    retryAssistantMessage,
    retryUserMessage,
    rollbackToMessage,
    sendUserMessage,
    stopAssistant,
    updateMessage,
  } = useMessageActions(
    threadId ?? undefined,
    incognito.enabled,
    assistantStreamDriver,
  );
  const { setModel: setThreadModel, compactThread } = useThreadActions();
  const [showThreadShell, setShowThreadShell] = useState(inThreadView);
  const mobileHome = !minMd && !showThreadShell;
  useEffect(() => {
    if (inThreadView) setShowThreadShell(true);
    else if (messages.length === 0) setShowThreadShell(false);
  }, [inThreadView, messages.length]);

  const isGen = computeIsGenerating(messages);
  // The composer floats over the chat, so the feed's bottom padding tracks its
  // real height — a growing draft shifts the conversation up instead of
  // covering the latest message.
  const {
    containerRef,
    dockRef: composerDockRef,
    viewportRef: chatViewportRef,
  } = useComposerClearance();
  // Settings toggle: when off, the feed stays put while replies stream and
  // the scroll-to-bottom button becomes the only chauffeur.
  const autoScroll = useAutoScrollPref();
  const scrollToBottomRef = useRef<(() => void) | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const setScrollToBottom = useCallback((handler: (() => void) | null) => {
    scrollToBottomRef.current = handler;
  }, []);
  const scrollToBottom = useCallback(() => {
    scrollToBottomRef.current?.();
  }, []);

  useEffect(() => {
    if (showThreadShell) return;
    setShowScrollToBottom(false);
    scrollToBottomRef.current = null;
  }, [showThreadShell]);

  // The backend deducts a free message once a response completes, but Autumn's
  // customer data is cached client-side. Refetch it when generation finishes so
  // the remaining-messages count updates live instead of going stale.
  const { refetch: refetchCustomer } = useCustomer();
  const wasGenRef = useRef(false);
  useEffect(() => {
    if (wasGenRef.current && !isGen) {
      void refetchCustomer();
    }
    wasGenRef.current = isGen;
  }, [isGen, refetchCustomer]);

  if (!isLoaded) {
    return null;
  }

  // Copy the thread up to a checkpoint into a fresh thread and hop over to it.
  const handleBranch = async (messageId: string) => {
    try {
      const result = await branchFromMessage(messageId);
      if (result) {
        void navigate({ to: `/thread/${result.threadId}` });
      }
    } catch (err) {
      showToast({
        tone: "danger",
        message:
          err instanceof Error ? err.message : "Couldn't branch this thread.",
      });
    }
  };

  // Rewind the thread to a checkpoint. The confirm dialog already ran — this
  // just fires the deletion (optimistically trimmed on screen).
  const handleRollback = async (messageId: string) => {
    try {
      await rollbackToMessage(messageId);
    } catch (err) {
      showToast({
        tone: "danger",
        message:
          err instanceof Error
            ? err.message
            : "Couldn't roll back this thread.",
      });
    }
  };

  const handleSubmit = async (
    value: string,
    attachments: Attachment[],
    options: {
      thinking: boolean;
      search: boolean;
      model: ModelKey;
      integrations?: IntegrationMentionRef[];
    },
  ) => {
    // Signed-out visitors can browse and draft a message, but any inference
    // requires an account — prompt them to sign in instead of sending.
    if (!requireAuth()) {
      return;
    }
    if (currentThread?.compactionStatus === "compacting") {
      return;
    }
    // Attachments arrive already uploaded — the composer streams them to Convex
    // storage the moment they're added.
    if (!value.trim() && attachments.length === 0) {
      return;
    }
    const pendingMessagesFor = (result: Awaited<ReturnType<typeof sendUserMessage>>) => {
      const now = Date.now();
      return {
        threadId: result.threadId,
        messages: [
          {
            id: result.userMessageId,
            role: "user",
            content: value,
            attachments,
            integrations: options.integrations,
            createdAt: now,
          },
          {
            id: result.assistantId,
            role: "assistant",
            content: "",
            createdAt: now + 1,
            status: options.thinking ? "thinking" : "streaming",
            phases: [],
            streamId: result.streamId,
            model: options.model,
            thinking: options.thinking,
            search: options.search,
          },
        ] satisfies Message[],
      };
    };

    if (incognito.enabled) {
      // Ephemeral chat: create the hidden thread on the first send and latch its
      // id in context (no navigation — we stay on "/"). Subsequent sends just
      // append to it. Everything is hard-purged when the user leaves incognito.
      const firstSend = !incognito.threadId;
      const result = await sendUserMessage(value, attachments, options);
      const pending = pendingMessagesFor(result);
      setPendingSend(pending);
      if (firstSend) {
        incognito.setThreadId(result.threadId);
      }
      return;
    }
    if (threadId) {
      const result = await sendUserMessage(value, attachments, options);
      setPendingSend(pendingMessagesFor(result));
    } else {
      const result = await sendUserMessage(value, attachments, options);
      setPendingSend(pendingMessagesFor(result));
      void navigate({ to: `/thread/${result.threadId}` });
    }
  };

  return (
    <div ref={containerRef} className="relative flex h-full min-h-0 flex-col">
      {routeThreadId && showThreadShell && !incognito.enabled && (
        <ThreadToolbar
          threadId={routeThreadId}
          threadTitle={currentThread?.title ?? ""}
          shareId={currentThread?.shareId ?? null}
          attachments={threadAttachments}
        />
      )}

      {/* The incognito toggle owns the top-right of the new-thread screen and
          stays there through a session so you can leave. Entering is desktop-only
          (the sidebar-hiding it pairs with is desktop-shaped), but once you're in
          it always shows — even if the window shrinks — so there's never a way to
          get stuck incognito with no exit. */}
      {!routeThreadId && (minMd || incognito.enabled) && (
        <div className="absolute right-3 top-3 z-30">
          <IncognitoToggle />
        </div>
      )}

      <div className={showThreadShell || mobileHome ? "" : "flex-1"} />

      {showThreadShell ? (
        <MessageScroller.Provider
          key={threadId ?? "no-thread"}
          autoScroll={autoScroll}
          defaultScrollPosition="end"
          scrollEdgeThreshold={CHAT_SCROLL_EDGE_THRESHOLD_PX}
          scrollMargin={CHAT_SCROLL_MARGIN_PX}
          scrollPreviousItemPeek={CHAT_SCROLL_PREVIOUS_ITEM_PEEK_PX}
        >
          <MessageScroller.Root className="relative min-h-0 flex-1">
            <MessageScroller.Viewport
              ref={chatViewportRef}
              className="chat-scroll h-full min-h-0 overflow-y-auto overscroll-contain"
              preserveScrollOnPrepend
            >
              <MessageScroller.Content
                aria-busy={isGen || showSkeleton}
                className={`mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5 px-5 pt-12 ${COMPOSER_CLEARANCE_CLASS}`}
                spacerClassName="shrink-0"
              >
                <ThreadWidgetAnimationProvider
                  threadId={threadId ?? undefined}
                  messages={messages}
                >
                  <AnimatePresence
                    key={threadId ?? "no-thread"}
                    initial={false}
                    onExitComplete={() => {
                      if (!inThreadView) setShowThreadShell(false);
                    }}
                  >
                    {messages.map((m, index) => {
                      const compactedAt = compactionMarkers.get(m.id);
                      return (
                        <MessageScroller.Item
                          key={m.id}
                          messageId={m.id}
                          scrollAnchor={m.role === "user"}
                          className="min-w-0 shrink-0"
                        >
                          <StreamingMessageBubble
                            message={m}
                            getToken={getToken}
                            streamUrl={assistantStreamUrl}
                            onEdit={
                              threadId && m.role === "user"
                                ? (content) => updateMessage(m.id, content)
                                : undefined
                            }
                            onRetry={
                              threadId
                                ? m.role === "user"
                                  ? () => retryUserMessage(m.id)
                                  : () => retryAssistantMessage(m.id)
                                : undefined
                            }
                            // Checkpoint actions live on assistant replies
                            // only — a full turn is the natural checkpoint,
                            // and user rows keep their tight copy/edit/retry
                            // trio. Branching copies into a persistent thread,
                            // so it has no place in incognito.
                            onBranch={
                              threadId &&
                              !incognito.enabled &&
                              m.role === "assistant"
                                ? () => void handleBranch(m.id)
                                : undefined
                            }
                            // Rolling back to the newest message would delete
                            // nothing, and rolling back mid-generation would
                            // yank a message the stream is still writing to.
                            onRollback={
                              threadId &&
                              m.role === "assistant" &&
                              !isGen &&
                              index < messages.length - 1
                                ? () => void handleRollback(m.id)
                                : undefined
                            }
                          />
                          {compactedAt != null ? (
                            <CompactionDivider compactedAt={compactedAt} />
                          ) : null}
                        </MessageScroller.Item>
                      );
                    })}
                  </AnimatePresence>
                </ThreadWidgetAnimationProvider>
              </MessageScroller.Content>
            </MessageScroller.Viewport>
            <ThreadScrollerControls
              threadId={threadId}
              messageCount={messages.length}
              onScrollButtonVisibleChange={setShowScrollToBottom}
              onScrollToBottomChange={setScrollToBottom}
            />
            <QuoteSelectionPopover />
            <AnimatePresence>
              {showSkeleton && <ThreadLoading key="thread-loading" />}
              {showLoadError && (
                <ThreadLoadError key="thread-load-error" error={messagesError} />
              )}
            </AnimatePresence>
          </MessageScroller.Root>
        </MessageScroller.Provider>
      ) : (
        <div
          className={`mx-auto flex w-full min-w-0 max-w-3xl justify-center px-3 sm:px-5 ${
            mobileHome ? "flex-1 items-center" : ""
          }`}
        >
          <Outlet />
        </div>
      )}

      <motion.div
        ref={composerDockRef}
        layout
        initial={inThreadView ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          layout: { type: "spring", stiffness: 180, damping: 28, mass: 1 },
          opacity: { duration: 0.35, ease: [0.22, 0.61, 0.36, 1] },
          y: { type: "spring", stiffness: 260, damping: 30 },
        }}
        className={
          showThreadShell || mobileHome
            ? "pointer-events-none absolute inset-x-0 bottom-0 mx-auto w-full max-w-3xl px-3 pb-4 max-md:pb-2 sm:px-5 sm:pb-6 [&>*]:pointer-events-auto"
            : "mx-auto w-full max-w-3xl px-3 pt-6 sm:px-5 sm:pt-10"
        }
      >
        <div className="relative">
          <AnimatePresence>
            {showThreadShell && showScrollToBottom && (
              <motion.div
                key="scroll-to-bottom"
                initial={{ opacity: 0, y: 6, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.94 }}
                transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
                className="pointer-events-none absolute inset-x-0 bottom-full mb-2.5 flex justify-center"
              >
                <button
                  type="button"
                  onClick={scrollToBottom}
                  aria-label="Scroll to latest message"
                  className={`pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full text-neutral-700 dark:text-neutral-200 ${COMPOSER_GLASS_CONTROL}`}
                >
                  <IconChevronDown size={16} stroke={2.5} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <Composer
            onSubmit={handleSubmit}
            getAttachmentUploadUrl={getAttachmentUploadUrl}
            onStop={threadId ? () => stopAssistant(messages) : undefined}
            isGenerating={computeIsGenerating(messages)}
            variant={showThreadShell ? "thread" : "home"}
            scrollButtonVisible={showThreadShell && showScrollToBottom}
            threadModel={currentThread?.model}
            onModelChange={threadId ? (m) => void setThreadModel(threadId, m) : undefined}
            compactionStatus={currentThread?.compactionStatus ?? "idle"}
            onCompact={
              threadId && !incognito.enabled
                ? () => {
                    void compactThread(threadId).catch((err) => {
                      showToast({
                        tone: "danger",
                        message:
                          err instanceof Error
                            ? err.message
                            : "Could not compact this thread.",
                      });
                    });
                  }
                : undefined
            }
          />
        </div>
      </motion.div>

      <div className={showThreadShell || mobileHome ? "" : "flex-1"} />

      {!showThreadShell && !mobileHome && <HomeFooter />}
    </div>
  );
}

function ThreadScrollerControls({
  messageCount,
  onScrollButtonVisibleChange,
  onScrollToBottomChange,
  threadId,
}: {
  messageCount: number;
  onScrollButtonVisibleChange: (visible: boolean) => void;
  onScrollToBottomChange: (handler: (() => void) | null) => void;
  threadId: string | null;
}) {
  const capture = useCapture();
  const { scrollToEnd } = useMessageScroller();
  const { end } = useMessageScrollerScrollable();

  useEffect(() => {
    onScrollButtonVisibleChange(end);
  }, [end, onScrollButtonVisibleChange]);

  useEffect(() => {
    onScrollToBottomChange(() => {
      capture(ANALYTICS_EVENTS.chatScrolledToLatest, {
        message_count: messageCount,
        thread_id: threadId,
      });
      scrollToEnd({ behavior: "smooth" });
    });
    return () => onScrollToBottomChange(null);
  }, [capture, messageCount, onScrollToBottomChange, scrollToEnd, threadId]);

  return null;
}

function StreamingMessageBubble({
  message,
  streamUrl,
  getToken,
  onEdit,
  onRetry,
  onBranch,
  onRollback,
}: {
  message: Message;
  streamUrl: URL;
  getToken: (options?: { template?: "convex"; skipCache?: boolean }) => Promise<string | null>;
  onEdit?: (content: string) => void;
  onRetry?: () => void;
  onBranch?: () => void;
  onRollback?: () => void;
}) {
  const terminalStatus =
    message.status === "complete" ||
    message.status === "stopped" ||
    message.status === "error";
  const driven = Boolean(
    message.streamId && drivenStreamIds.has(message.streamId) && !terminalStatus,
  );
  const liveStream = useLiveAssistantStream(message.streamId, driven);
  const liveStreamFailed =
    liveStream.started &&
    (liveStream.status === "error" || liveStream.status === "timeout");
  const persistentStream = useQuery(
    getStreamBodyRef as any,
    message.streamId && !terminalStatus && (!driven || liveStreamFailed)
      ? { streamId: message.streamId }
      : "skip",
  ) as StreamBody | undefined;
  const streamBody = persistentStream ?? liveStream;

  useEffect(() => {
    if (!driven || !message.streamId) return;
    startLiveAssistantStream({
      streamId: message.streamId,
      streamUrl,
      getAuthToken: () => getToken({ template: "convex" }),
    });
  }, [driven, getToken, message.streamId, streamUrl]);

  useEffect(() => {
    if (terminalStatus && message.streamId) {
      drivenStreamIds.delete(message.streamId);
      clearLiveAssistantStream(message.streamId);
    }
  }, [message.streamId, terminalStatus]);

  const sourceText =
    terminalStatus
      ? message.content
      : streamBody.text ||
        message.content ||
        (streamBody.status === "error" ? "Something went wrong." : "");
  // Keep the typewriter live for the whole driven turn — including after the
  // server reports "done" — so the buffered tail keeps revealing gradually
  // instead of snapping in all at once. (It idles on its own once caught up.)
  const isLive = driven;
  const displayedText = useTypewriter(sourceText, isLive);
  // The reply isn't "complete" until the typewriter has caught up to the full
  // text. Until then keep it "streaming" so the fade-in keeps running over the
  // trailing characters rather than ending early and dumping the rest in.
  const caughtUp = displayedText.length >= sourceText.length;
  // While the server stream is still open but no new text has landed for a beat,
  // surface the live indicator again so a slow model doesn't just sit on a frozen
  // half-message. Gate on `caughtUp` so the typewriter's own lag never reads as a
  // stall, and on the open status so the post-"done" buffered tail doesn't either.
  const streamOpen =
    streamBody.status !== "done" &&
    streamBody.status !== "error" &&
    streamBody.status !== "timeout";
  const sourceStalled = useStreamStalled(sourceText, driven && streamOpen);
  const streamStalled = sourceStalled && caughtUp;

  if (message.role !== "assistant" || !message.streamId) {
    return (
      <MessageBubble
        message={message}
        onEdit={onEdit}
        onRetry={onRetry}
        onBranch={onBranch}
        onRollback={onRollback}
      />
    );
  }

  const streamedMessage: Message = {
    ...message,
    content: displayedText,
    status:
      terminalStatus
        ? message.status
        : streamBody.status === "error" || streamBody.status === "timeout"
        ? "error"
        : streamBody.status === "done" && caughtUp
          ? "complete"
          : streamBody.text
            ? "streaming"
            : message.status,
  };

  return (
    <MessageBubble
      message={streamedMessage}
      onEdit={onEdit}
      onRetry={onRetry}
      onBranch={onBranch}
      onRollback={onRollback}
      streamStalled={streamStalled}
    />
  );
}

// True once `source` hasn't grown for ~1s while `active`. Resets the moment new
// text arrives, so it only latches during a genuine lull in the token stream.
function useStreamStalled(source: string, active: boolean): boolean {
  const [stalled, setStalled] = useState(false);
  const lastLenRef = useRef(source.length);

  useEffect(() => {
    if (!active) {
      setStalled(false);
      return;
    }
    if (source.length !== lastLenRef.current) {
      lastLenRef.current = source.length;
      setStalled(false);
    }
    const t = window.setTimeout(() => setStalled(true), 1000);
    return () => window.clearTimeout(t);
  }, [source, active]);

  return stalled;
}

function useTypewriter(source: string, enabled: boolean): string {
  const [displayed, setDisplayed] = useState(source);
  const sourceRef = useRef(source);
  const displayedRef = useRef(displayed);
  const timerRef = useRef<number | null>(null);

  sourceRef.current = source;

  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (displayedRef.current !== source) {
        displayedRef.current = source;
        setDisplayed(source);
      }
      return;
    }
    if (displayedRef.current.length > source.length) {
      displayedRef.current = source;
      setDisplayed(source);
      return;
    }
    if (displayedRef.current === source) return;
    if (timerRef.current != null) return;
    const tick = () => {
      timerRef.current = null;
      const src = sourceRef.current;
      const cur = displayedRef.current.length;
      if (cur >= src.length) {
        return;
      }
      const remaining = src.length - cur;
      // Reveal a fraction of the backlog each tick so the typewriter tracks the
      // model's real pace instead of throttling it to a fixed rate. A slow
      // trickle still reveals a char or two at a time — the per-char fade (see
      // `[data-sd-animate]` in app.css) fires on mount, so small steps give the
      // reveal its left-to-right stagger. When a quick model (e.g. Fast)
      // races ahead, the step scales up so the reply stays ~a couple hundred ms
      // behind the live edge instead of crawling seconds behind text that's
      // already been generated. The old hard cap of 3 chars/tick pinned the
      // reveal at ~107 chars/sec (~27 tok/s), so anything faster fell ever
      // further behind. The ceiling now only guards against a single huge jump
      // fading in a whole screen of text as one block.
      const advance = Math.min(64, Math.max(1, Math.ceil(remaining / 8)));
      const next = src.slice(0, cur + advance);
      displayedRef.current = next;
      // Defer so Streamdown's heavy re-render doesn't block input on every tick.
      startTransition(() => setDisplayed(next));
      if (next.length < src.length) {
        timerRef.current = window.setTimeout(tick, 28);
      }
    };
    timerRef.current = window.setTimeout(tick, 28);
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [source, enabled]);

  return displayed;
}

function ThreadLoading() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
      className="pointer-events-none absolute inset-0 flex items-center justify-center text-neutral-400 dark:text-neutral-500"
    >
      <Spinner size={18} className="text-blue-500" />
    </motion.div>
  );
}

function ThreadLoadError({ error }: { error: Error | null }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
      className="absolute inset-0 flex items-center justify-center px-6"
    >
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-400">
          <IconAlertTriangle size={20} stroke={2} />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-[14px] font-medium text-neutral-800 dark:text-neutral-100">
            Couldn't load this conversation
          </p>
          <p className="text-[12.5px] leading-5 text-neutral-500 dark:text-neutral-400">
            {error?.message || "Something went wrong on our end."}
          </p>
        </div>
        <DepthButton
          type="button"
          onClick={() => window.location.reload()}
          className="mt-1 flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200"
        >
          <IconReload size={13} stroke={2.5} />
          Try again
        </DepthButton>
      </div>
    </motion.div>
  );
}
