import { useEffect, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";

import { MessageBubble } from "~/components/message-bubble";
import { RainbowLoader } from "~/components/rainbow-loader";
import { ForkComposer } from "~/components/share/fork-composer";
import { ShareTopBar } from "~/components/share/share-top-bar";
import { ThreadWidgetAnimationProvider } from "~/components/thread-widget-animation";
import { WhirlLogo } from "~/components/whirl-logo";
import type { Message, Phase } from "~/data/messages";
import {
  useSharedThread,
  type SharedMessageData,
  type SharedThread,
} from "~/lib/shared-artifacts";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";
import { seo } from "~/lib/seo";
import {
  COMPOSER_CLEARANCE_CLASS,
  useComposerClearance,
} from "~/lib/use-composer-clearance";

export const Route = createFileRoute("/share/$shareId")({
  component: SharePage,
  head: () =>
    seo({
      title: "Shared on Whirl",
      description: "A conversation shared from Whirl.",
    }),
});

/**
 * Rebuild a chat `Message` from the trimmed shared payload, so a shared thread
 * renders through the exact same `MessageBubble` (and document/HTML cards) as a
 * live thread — no bespoke read-only UI. The artifacts become finalized
 * `document`/`html` phases positioned at the offsets they were created; the
 * cards read their content from the injected shared-artifact store (provided by
 * the shell) rather than Convex.
 */
function toMessage(m: SharedMessageData, thread: SharedThread): Message {
  if (m.role === "user") {
    return {
      id: m.id,
      role: "user",
      content: m.content,
      createdAt: m.createdAt,
      status: "complete",
    };
  }

  const phases: Phase[] = m.artifacts.map((a) => {
    const contentOffset = a.contentOffset != null ? a.contentOffset : undefined;
    const editCount = a.editCount != null ? a.editCount : undefined;
    if (a.kind === "html") {
      const viz = thread.visualizations[a.refId];
      return {
        kind: "html",
        htmlId: a.refId,
        mode: viz?.kind,
        op: a.op,
        title: viz?.title,
        editCount,
        ok: true,
        pending: false,
        contentOffset,
      };
    }
    const doc = thread.documents[a.refId];
    return {
      kind: "document",
      documentId: a.refId,
      op: a.op,
      title: doc?.title,
      editCount,
      ok: true,
      pending: false,
      contentOffset,
    };
  });

  return {
    id: m.id,
    role: "assistant",
    content: m.content,
    createdAt: m.createdAt,
    status: "complete",
    phases,
  };
}

function SharePage() {
  const { shareId } = Route.useParams();
  const thread = useSharedThread(shareId);

  useEffect(() => {
    if (thread?.title) document.title = `${thread.title} · Whirl`;
  }, [thread?.title]);

  if (thread === undefined) return <LoadingState />;
  if (thread === null) return <NotFoundState />;
  return <Conversation thread={thread} shareId={shareId} />;
}

function Conversation({
  thread,
  shareId,
}: {
  thread: SharedThread;
  shareId: string;
}) {
  const capture = useCapture();
  // The fork composer floats over the feed just like the live thread's, so the
  // same clearance tracking keeps the last message readable while a draft grows.
  const {
    containerRef,
    dockRef: composerDockRef,
    viewportRef: chatViewportRef,
  } = useComposerClearance();
  const messages = useMemo(
    () => thread.messages.map((m) => toMessage(m, thread)),
    [thread],
  );

  useEffect(() => {
    capture(ANALYTICS_EVENTS.sharedThreadViewed, {
      message_count: messages.length,
      document_count: Object.keys(thread.documents).length,
      visualization_count: Object.keys(thread.visualizations).length,
    });
    // Fire once per share — re-fires when navigating straight to another share
    // (same mounted component), so in-app transitions aren't undercounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]);

  return (
    <div ref={containerRef} className="relative flex h-full min-h-0 flex-col">
      <ShareTopBar />
      <div
        ref={chatViewportRef}
        className="chat-scroll relative min-h-0 flex-1 overflow-y-auto"
      >
        <div
          className={`mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 pt-12 ${COMPOSER_CLEARANCE_CLASS}`}
        >
          <ThreadWidgetAnimationProvider threadId={shareId} messages={messages}>
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
            </AnimatePresence>
          </ThreadWidgetAnimationProvider>
        </div>
      </div>
      {/* Floating fork composer, positioned exactly like the live thread's. */}
      <div
        ref={composerDockRef}
        className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto w-full max-w-3xl px-3 pb-4 max-md:pb-2 sm:px-5 sm:pb-6 [&>*]:pointer-events-auto"
      >
        <ForkComposer shareId={shareId} />
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center">
      <RainbowLoader />
    </div>
  );
}

function NotFoundState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
      <WhirlLogo size={40} />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[17px] font-semibold text-neutral-900 dark:text-neutral-100">
          This conversation isn't available
        </h1>
        <p className="max-w-sm text-[13.5px] text-neutral-500 dark:text-neutral-400">
          The link may be wrong, or sharing was turned off. But you can start
          your own chat in seconds.
        </p>
      </div>
      <a
        href="/"
        className="flex h-10 items-center rounded-xl bg-[#0c82f2] px-5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#0a74d8]"
      >
        Start a new chat
      </a>
    </div>
  );
}
