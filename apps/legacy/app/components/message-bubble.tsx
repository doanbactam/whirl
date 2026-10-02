import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  IconCheck,
  IconCopy,
  IconLink,
  IconPencil,
  IconReload,
  IconSearch,
  IconX,
} from "@tabler/icons-react";

import type {
  Attachment,
  Message,
  MessageStatus,
  Phase,
  SearchSource,
} from "~/data/messages";
import { ActionButton } from "~/components/message-action-button";
import { ModalCard } from "~/components/modal-card";
import { Squircle } from "~/components/squircle";
import { CheckpointMenu } from "~/components/checkpoint-actions";
import { useShouldAnimateWidgets } from "~/components/thread-widget-animation";
import { WhirlMorph } from "~/components/whirl-morph";
import { LiveActivity } from "~/components/activity/live-activity";
import {
  statusActivityKind,
  type ActivityKind,
} from "~/components/activity/activity-kinds";
import {
  PhaseChip,
  formatDurationSec,
  isChipPhase,
} from "~/components/activity/phase-chip";
import { PhaseGroup } from "~/components/activity/phase-group";
import {
  buildRenderPlan,
  shouldRenderPhase,
  type RenderItem,
} from "~/components/activity/render-plan";
import { ArtifactActivityScope } from "~/components/activity/artifact-activity";
import { ReasoningModal } from "~/components/reasoning-modal";
import { DocumentCard } from "~/components/document/document-card";
import { HtmlCard } from "~/components/html/html-card";
import {
  AttachmentCard,
  AttachmentImageThumb,
} from "~/components/attachment-card";
import { AttachmentPreviewModal } from "~/components/attachment-preview-modal";
import {
  InlineMentionPill,
  splitMentionSegments,
  type IntegrationMention,
} from "~/components/composer-mentions";
import { IntegrationSuggestionCard } from "~/components/integrations/integration-suggestion-card";
import { GeneratedImageSlot } from "~/components/generated-image";
import {
  ImagePhaseCard,
  isImageCardPhase,
} from "~/components/image-phase-card";
import { ImageViewer } from "~/components/image-viewer";
import {
  attachmentKind,
  isMarkdownAttachment,
  openInNewTab,
} from "~/lib/attachment-open";
import { useDocumentSidebar } from "~/lib/document-sidebar";
import { useComposerIngest } from "~/lib/composer-ingest";
import { showToast } from "~/data/toasts";
import { MemoryAddedIndicator } from "~/components/memory-indicator";
import { MessageStats } from "~/components/message-stats";
import { Markdown } from "~/components/markdown/markdown-message";
import { CalcDetailModal } from "~/components/math/calc-detail-modal";
import { WeatherWidget } from "~/components/weather/weather-widget";
import {
  parseGateSentinel,
  useUpgrade,
  type GateFeature,
} from "~/components/upgrade-modal";
import { ServerOverloadBanner } from "~/components/server-overload";
import { isOverloadSentinel } from "~/lib/server-load";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";
import { useMinMd } from "~/lib/use-media";
import { useOpenExtraUsage } from "~/lib/use-open-extra-usage";

export function MessageBubble({
  message,
  onEdit,
  onRetry,
  onBranch,
  onRollback,
  streamStalled = false,
}: {
  message: Message;
  onEdit?: (content: string) => void;
  onRetry?: () => void;
  /** Spin the thread up to this message into a new thread. */
  onBranch?: () => void;
  /** Rewind the thread to this message, deleting everything after it. */
  onRollback?: () => void;
  streamStalled?: boolean;
}) {
  const isUser = message.role === "user";
  const [editing, setEditing] = useState(false);
  const status = message.status;
  const isStreaming = status === "streaming";
  const hasText = message.content.trim().length > 0;
  const isPending =
    !isUser && (status === "thinking" || status === "searching");
  // Blur the whole row in once when it mounts already-settled — opening a cached
  // thread, where messages appear complete with no streaming reveal. Covers the
  // avatar, user bubbles and reply alike. Captured at mount (and always true for
  // user turns, which never stream) so a reply that *finishes* streaming live
  // never re-blurs at the end; live assistant turns let the per-char fade lead.
  const [blurInOnMount] = useState(
    () => isUser || (!isStreaming && !isPending),
  );
  const isLiveAssistant = !isUser && (isPending || isStreaming);
  const showActions =
    !editing &&
    !isLiveAssistant &&
    (isUser ||
      hasText ||
      status === undefined ||
      status === "stopped" ||
      status === "error");
  const canRetryNow =
    status === "complete" || status === "stopped" || status === "error";

  const avatarBusy =
    !isUser &&
    (status === "thinking" || status === "searching" || status === "streaming");
  const widgetAnimate = useShouldAnimateWidgets(message.id);

  // Everything @-mentionable in this sent message, so the bubble text renders
  // tokens as pills instead of raw "@name" strings: tagged integrations and
  // skills (with their hydrated branding) and image attachments (with the
  // picture itself as the pill's face).
  const mentionables = useMemo<IntegrationMention[]>(() => {
    if (!isUser) return [];
    return [
      ...(message.integrations ?? []).map((m) => ({
        serverId: m.serverId,
        name: m.name,
        logoUrl: m.logoUrl ?? null,
        iconSvg: m.iconSvg,
      })),
      ...(message.skills ?? []).map((m) => ({
        serverId: m.installId,
        name: m.name,
        logoUrl: m.logoUrl ?? null,
        iconSvg: m.iconSvg,
      })),
      ...(message.attachments ?? [])
        .filter((a) => a.type.startsWith("image/"))
        .map((a) => ({
          serverId: `image-tag:${a.id}`,
          name: a.name,
          logoUrl: a.url ?? null,
        })),
    ];
  }, [isUser, message.integrations, message.skills, message.attachments]);

  return (
    // Deliberately no `layout` animation here (or anywhere inside the chat
    // feed): the feed lives in a plain scroll container framer can't track, so
    // the auto-scroll jump on send reads as a position change and every
    // settled bubble springs toward its "new" spot — the whole thread used to
    // jitter on each follow-up. Natural document flow handles reflow fine.
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{
        opacity: { duration: 0.2, ease: [0.22, 0.61, 0.36, 1] },
        y: { duration: 0.22, ease: [0.22, 0.61, 0.36, 1] },
      }}
      className={`group/msg flex w-full ${
        isUser ? "" : "items-start gap-2.5"
      }${blurInOnMount ? " message-blur-in" : ""}`}
    >
      {!isUser && <AssistantAvatar busy={avatarBusy} />}
      <div
        className={`flex min-w-0 flex-1 flex-col ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        {!isUser && message.model === "Image" ? (
          // Image-model replies own their attachment slot: a shimmer while the
          // picture is being painted, then a morph-reveal into the real thing.
          <GeneratedImageSlot message={message} />
        ) : (
          message.attachments &&
          message.attachments.length > 0 && (
            <Attachments
              attachments={message.attachments}
              alignEnd={isUser}
              hasText={hasText || editing}
            />
          )
        )}
        <AnimatePresence mode="wait" initial={false}>
          {editing && onEdit ? (
            <EditBubble
              key="edit"
              initial={message.content}
              isUser={isUser}
              onCancel={() => setEditing(false)}
              onSave={(next) => {
                onEdit(next);
                setEditing(false);
              }}
            />
          ) : isUser ? (
            hasText && (
              <motion.div
                key="view"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
                data-quotable="user"
                className="max-w-[85%] min-w-0"
              >
                <Squircle
                  radius={{ topLeft: 20, topRight: 20, bottomRight: 12, bottomLeft: 20 }}
                  className="rounded-[20px] rounded-br-md bg-black/[0.06] px-4 py-2.5 text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08)] [overflow-wrap:anywhere] dark:bg-white/[0.08] dark:text-neutral-100"
                >
                  <CollapsibleText
                    content={message.content}
                    mentionables={mentionables}
                  />
                </Squircle>
              </motion.div>
            )
          ) : (
            (() => {
              if (status === "error" && isOverloadSentinel(message.content)) {
                return <ServerOverloadBanner key="overload" />;
              }
              const gateFeature = parseGateSentinel(message.content);
              if (gateFeature && status === "error") {
                return <GateBanner key="gate" feature={gateFeature} />;
              }
              // Image turns: the generated-image slot above is the live
              // indicator, and an empty caption has nothing to say — no
              // loading dots under the skeleton.
              if (message.model === "Image" && !hasText) {
                return null;
              }
              return (
                <AssistantBody
                  key="view"
                  content={message.content}
                  phases={message.phases ?? []}
                  isStreaming={isStreaming}
                  isPending={isPending}
                  status={status}
                  thinking={message.thinking ?? false}
                  streamStalled={streamStalled}
                  animate={avatarBusy}
                  widgetAnimate={widgetAnimate}
                />
              );
            })()
          )}
        </AnimatePresence>
        {status === "stopped" && <StoppedIndicator />}
        {showActions ? (
          <MessageActions
            content={message.content}
            alignEnd={isUser}
            onEdit={onEdit ? () => setEditing(true) : undefined}
            onRetry={onRetry && (isUser || canRetryNow) ? onRetry : undefined}
            onBranch={onBranch}
            onRollback={onRollback}
            addedMemoryIds={!isUser ? message.addedMemoryIds : undefined}
            outputTokens={!isUser ? message.outputTokens : undefined}
            durationMs={!isUser ? message.durationMs : undefined}
            usageCost={!isUser ? message.usageCost : undefined}
          />
        ) : null}
      </div>
    </motion.div>
  );
}

function GateBanner({ feature }: { feature: GateFeature }) {
  const { open } = useUpgrade();
  const openExtraUsage = useOpenExtraUsage();
  const canTopUp = feature === "usage";
  const headline =
    feature === "usage"
      ? "Out of usage"
      : feature === "messages"
        ? "Out of free messages"
        : feature === "can_search"
          ? "Web search is on paid plans"
          : feature === "basic"
            ? "Fast is on paid plans"
            : feature === "pro" || feature === "max"
              ? "Heavy lives on Turbo"
              : feature === "image"
                ? "Image generation lives on Turbo"
                : feature === "files"
                  ? "Larger uploads are on paid plans"
                  : feature === "compact"
                    ? "Compaction is on paid plans"
                    : "Thinking is on paid plans";
  const sub =
    feature === "usage"
      ? "Your pool ran out — add usage now, or upgrade for a bigger budget."
      : feature === "messages"
        ? "You've used all your free messages for today — upgrade to keep chatting."
        : "Upgrade to unlock this on your account.";
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
      className="flex max-w-full min-w-0 flex-col items-start gap-2 rounded-2xl border border-amber-200/70 bg-amber-50 px-3.5 py-2.5 dark:border-amber-500/20 dark:bg-amber-500/[0.08]"
    >
      <div className="flex flex-col">
        <span className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">
          {headline}
        </span>
        <span className="text-[12px] text-amber-800/80 dark:text-amber-200/70">
          {sub}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {canTopUp && (
          <button
            type="button"
            onClick={openExtraUsage}
            className="inline-flex h-7 items-center rounded-lg bg-amber-600 px-2.5 text-[12px] font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-neutral-900"
          >
            Add usage
          </button>
        )}
        <button
          type="button"
          onClick={() => open(feature)}
          className={
            canTopUp
              ? "inline-flex h-7 items-center rounded-lg px-2.5 text-[12px] font-medium text-amber-800 transition hover:bg-amber-600/10 dark:text-amber-200 dark:hover:bg-amber-400/10"
              : "inline-flex h-7 items-center rounded-lg bg-amber-600 px-2.5 text-[12px] font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-neutral-900"
          }
        >
          See plans
        </button>
      </div>
    </motion.div>
  );
}

function AssistantAvatar({ busy }: { busy: boolean }) {
  return (
    <div className="relative flex h-7 w-7 shrink-0 items-center justify-center pt-0.5">
      {/* While generating, the whirl rings breathe in rainbow; when it
          finishes they wind down and settle into the static logo. The
          continuityId carries the ring pose across the streaming->completed
          bubble handoff, which remounts this avatar mid-motion — without it
          the fresh mount snaps to the rest pose in one frame. Only one
          avatar animates at a time, so a fixed id is enough. */}
      <WhirlMorph busy={busy} size={20} continuityId="assistant-avatar" />
    </div>
  );
}

function AssistantBody({
  content,
  phases,
  isStreaming,
  isPending,
  status,
  thinking,
  streamStalled,
  animate,
  widgetAnimate,
}: {
  content: string;
  phases: Phase[];
  isStreaming: boolean;
  isPending: boolean;
  status: MessageStatus | undefined;
  thinking: boolean;
  streamStalled: boolean;
  animate: boolean;
  widgetAnimate: boolean;
}) {
  const [sourcesPhaseIdx, setSourcesPhaseIdx] = useState<number | null>(null);
  const [reasoningPhaseIdx, setReasoningPhaseIdx] = useState<number | null>(
    null,
  );
  const [calcPhaseIdx, setCalcPhaseIdx] = useState<number | null>(null);
  // Artifact cards register here while visibly working (see
  // ArtifactActivityScope), so the bottom activity row stays suppressed even
  // when only the live row — not the phase — knows work is still happening.
  const [workingCardIds, setWorkingCardIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const reportArtifactWorking = useCallback((id: string, working: boolean) => {
    setWorkingCardIds((prev) => {
      if (prev.has(id) === working) return prev;
      const next = new Set(prev);
      if (working) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const capture = useCapture();
  // The reply flattened into render order: prose blocks, standalone phases,
  // and chains of back-to-back tool calls folded into single group items.
  const renderItems = useMemo(
    () => buildRenderPlan(content, phases),
    [content, phases],
  );

  // Track when a slow model stalls mid-reply (text already on screen) so we can
  // see how often the lull indicator actually fires.
  useEffect(() => {
    if (isStreaming && streamStalled && content.trim().length > 0) {
      capture(ANALYTICS_EVENTS.streamStalled, { thinking });
    }
  }, [isStreaming, streamStalled, content, thinking, capture]);

  const openItems =
    sourcesPhaseIdx !== null &&
    (phases[sourcesPhaseIdx]?.kind === "search" ||
      phases[sourcesPhaseIdx]?.kind === "fetch")
      ? ((
          phases[sourcesPhaseIdx] as Extract<
            Phase,
            { kind: "search" | "fetch" }
          >
        ).items ?? [])
      : [];

  const openThought =
    reasoningPhaseIdx !== null && phases[reasoningPhaseIdx]?.kind === "thought"
      ? (phases[reasoningPhaseIdx] as Extract<Phase, { kind: "thought" }>)
      : null;

  const openCalc =
    calcPhaseIdx !== null && phases[calcPhaseIdx]?.kind === "calc"
      ? (phases[calcPhaseIdx] as Extract<Phase, { kind: "calc" }>)
      : null;

  // Click opens sources (search), the raw reasoning (a finalized thought that
  // captured text), or the full calculation (an invisible step). Pending phases
  // aren't clickable.
  const phaseClick = (phase: Phase, index: number) => {
    if (
      (phase.kind === "search" || phase.kind === "fetch") &&
      (phase.items?.length ?? 0) > 0
    ) {
      return () => {
        capture(ANALYTICS_EVENTS.sourcesOpened, {
          source_count: phase.items?.length ?? 0,
          kind: phase.kind,
        });
        setSourcesPhaseIdx(index);
      };
    }
    if (
      phase.kind === "thought" &&
      !phase.pending &&
      (phase.text?.trim().length ?? 0) > 0
    ) {
      return () => {
        capture(ANALYTICS_EVENTS.reasoningOpened, {
          duration_ms: phase.durationMs,
        });
        setReasoningPhaseIdx(index);
      };
    }
    if (
      phase.kind === "calc" &&
      !phase.pending &&
      !phase.error &&
      (phase.expression || phase.result || (phase.items?.length ?? 0) > 0)
    ) {
      return () => {
        capture(ANALYTICS_EVENTS.calculationOpened, {
          batch: (phase.items?.length ?? 0) > 0,
        });
        setCalcPhaseIdx(index);
      };
    }
    return undefined;
  };

  // Most phases render as a chip that lives through its whole pending →
  // complete arc in place; weather is the exception once finalized — it hands
  // off from its pending chip to the full inline widget.
  const renderPhase = (phase: Phase, index: number, topMargin: boolean) => {
    if (phase.kind === "weather" && !phase.pending) {
      return (
        <WeatherWidget
          key={`phase-${index}`}
          phase={phase}
          animate={widgetAnimate}
        />
      );
    }
    // Integrations whirl suggested from the store: a chip while searching,
    // then this inline card of install buttons once matches land.
    if (phase.kind === "integrationSuggestion" && !phase.pending) {
      return (
        <IntegrationSuggestionCard
          key={`phase-${index}`}
          phase={phase}
          animate={widgetAnimate}
        />
      );
    }
    // A document whirl authored/revised, shown as a full inline card (it runs
    // its own progress bar while pending, so it renders even before finalizing).
    if (phase.kind === "document") {
      return <DocumentCard key={`phase-${index}`} phase={phase} />;
    }
    // An HTML artifact whirl authored/revised: an inline visualization or a
    // full page (which opens in the side panel). Runs its own progress state,
    // so it renders even while pending.
    if (phase.kind === "html") {
      return <HtmlCard key={`phase-${index}`} phase={phase} />;
    }
    // A background-painted image: shimmer card while the worker paints (it
    // can finish after the reply does — the phase updates reactively), then
    // the picture blooms in place. Failed paints fall through to the chip.
    if (isImageCardPhase(phase)) {
      return (
        <ImagePhaseCard
          key={`phase-${index}`}
          phase={phase}
          topMargin={topMargin}
        />
      );
    }
    if (!isChipPhase(phase)) return null;
    return (
      <PhaseChip
        key={`phase-${index}`}
        phase={phase}
        live={index === lastPendingChipIndex}
        animate={animate}
        entrance={chipEntrance(index)}
        topMargin={topMargin}
        onClick={phaseClick(phase, index)}
      />
    );
  };

  // A pending chip renders inline and IS the live indicator, so the message
  // never needs a second one. When several chips are pending at once (parallel
  // tool calls), only the last rotates verbs — the rest hold a static gerund.
  // Standalone hidden phases (an mcp call still anonymous) don't count: the
  // bottom status row keeps bridging until their chip actually shows. Inside
  // a chain the group is the indicator, so its pendings count named or not.
  let lastPendingChipIndex = -1;
  let pendingGroupKey: string | null = null;
  for (const item of renderItems) {
    if (item.type === "phase") {
      if (isChipPhase(item.phase) && item.phase.pending) {
        lastPendingChipIndex = item.index;
        pendingGroupKey = null;
      }
    } else if (item.type === "group") {
      for (const chip of item.chips) {
        if (chip.phase.pending) {
          lastPendingChipIndex = chip.index;
          pendingGroupKey = item.key;
        }
      }
    }
  }
  // A trailing chain on a live message stays "open" through the gaps between
  // calls — it hums the working verbs while the model decides its next move,
  // so the bottom status row must not double up beneath it.
  const msgLive = isPending || isStreaming;
  const lastRenderItem = renderItems[renderItems.length - 1];
  const trailingOpenGroupKey =
    msgLive && lastRenderItem?.type === "group" ? lastRenderItem.key : null;
  const groupOpen = (item: Extract<RenderItem, { type: "group" }>) =>
    item.key === trailingOpenGroupKey ||
    item.chips.some((chip) => chip.phase.pending);
  // The one element that owns the message's rotating-verb slot, when it's a
  // chain: the group holding the last pending chip, or — with nothing pending
  // at all — an open trailing group riding out a gap between calls.
  const liveGroupKey =
    pendingGroupKey ??
    (lastPendingChipIndex === -1 ? trailingOpenGroupKey : null);
  const anyPendingChip =
    lastPendingChipIndex !== -1 || trailingOpenGroupKey !== null;
  // A working document or HTML card runs its own progress bar, so it stands in
  // for the live indicator — don't also show the generic loading dots beneath
  // it. Cards report row-driven work (a background page build, an inline body
  // still settling) that can outlive the phase's pending flag. A pending image
  // phase is its own shimmer card (see ImagePhaseCard), so it counts too.
  const artifactWorking =
    workingCardIds.size > 0 ||
    phases.some(
      (phase) =>
        (phase.kind === "document" ||
          phase.kind === "html" ||
          phase.kind === "image") &&
        phase.pending === true,
    );
  // The first act of a reply (no prose yet) takes over from the bottom status
  // row in place — skip that chip's entrance so the handoff doesn't re-blur.
  const firstRenderedPhaseIdx = phases.findIndex(shouldRenderPhase);
  const chipEntrance = (index: number) =>
    !(content.trim().length === 0 && index === firstRenderedPhaseIdx);
  // Whether the reply currently *ends* with a finalized artifact (a viz/doc card
  // with no prose written after it). When it does, that card is the visible
  // output — so we must not park a "loading"/"thinking" indicator beneath it
  // while the model just wraps up the turn (that's the stray spinner that used
  // to linger under a finished inline visualization).
  const renderedArtifacts = phases.filter(
    (phase) =>
      ((phase.kind === "document" || phase.kind === "html") &&
        phase.ok !== false) ||
      isImageCardPhase(phase),
  );
  const hasTailArtifact = renderedArtifacts.some(
    (phase) => typeof phase.contentOffset !== "number",
  );
  const lastArtifactOffset = renderedArtifacts.reduce(
    (max, phase) =>
      typeof phase.contentOffset === "number"
        ? Math.max(max, phase.contentOffset)
        : max,
    -1,
  );
  const proseAfterLastArtifact =
    !hasTailArtifact &&
    lastArtifactOffset >= 0 &&
    content.slice(lastArtifactOffset).trim().length > 0;
  const endsWithArtifact =
    renderedArtifacts.length > 0 && !proseAfterLastArtifact;

  // The bottom row only stands in when nothing else represents the work: no
  // pending chip (it's the live indicator now) and no working artifact card.
  let activityKind: ActivityKind | null = null;
  if (!anyPendingChip && !artifactWorking) {
    if (isPending) {
      activityKind = statusActivityKind(status);
    } else if (
      isStreaming &&
      !endsWithArtifact &&
      (content.trim().length === 0 || streamStalled)
    ) {
      // Bridge the gap before any text lands — or a mid-stream lull when a slow
      // model stops emitting tokens for a beat. Only call it "thinking" when the
      // user actually turned thinking on — otherwise show bare loading dots, so a
      // reasoning-off reply never flashes a brain/"Pondering" indicator. Skipped
      // once the reply ends with a finalized artifact (see above).
      activityKind = thinking ? "thinking" : "loading";
    }
  }
  const liveTopMargin = content.length > 0 || phases.some((p) => !p.pending);
  const keepLiveActivitySlot =
    isStreaming && liveTopMargin && !anyPendingChip && !artifactWorking;

  // Only the prose block still growing at the content's edge streams — text
  // that settled before an inline phase renders complete.
  const trailingText = (item: Extract<RenderItem, { type: "text" }>) =>
    item.startOffset + item.text.length >= content.length;

  return (
    <ArtifactActivityScope report={reportArtifactWorking}>
      {/* w-full (not shrink-to-fit): the parent column is items-start, so
          without it this wrapper sizes to its widest child and a `w-full`
          artifact card inherits whatever width the prose happened to be —
          inline viz cards came out a different size in every reply. Children
          are still flex items in an items-start column, so chips and text
          keep their own content width. */}
      <motion.div
        initial={false}
        data-quotable="assistant"
        className="flex w-full min-w-0 flex-col items-start"
      >
        {/* A pending phase the server abandons gets spliced out of the array
            — AnimatePresence lets its chip animate away instead of popping.
            The same exit covers chips consolidating into a chain: the third
            call turns two standalone chips into one group item mid-stream. */}
        <AnimatePresence>
          {renderItems.map((item, i) => {
            const afterText = i > 0 && renderItems[i - 1].type === "text";
            if (item.type === "text") {
              return (
                <motion.div
                  key={item.key}
                  initial={
                    item.startOffset === 0
                      ? { opacity: 0, scale: 0.98 }
                      : { opacity: 0, y: 4 }
                  }
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
                  className={`max-w-full min-w-0 text-neutral-800 dark:text-neutral-100 [overflow-wrap:anywhere] ${
                    i > 0 ? "mt-1.5" : ""
                  }`}
                >
                  <Markdown
                    content={item.text}
                    inverted={false}
                    streaming={isStreaming && trailingText(item)}
                  />
                </motion.div>
              );
            }
            if (item.type === "group") {
              return (
                <PhaseGroup
                  key={item.key}
                  chips={item.chips}
                  open={groupOpen(item)}
                  live={item.key === liveGroupKey}
                  animate={animate}
                  entrance={chipEntrance(item.chips[0].index)}
                  topMargin={afterText}
                  chipClick={phaseClick}
                />
              );
            }
            return renderPhase(item.phase, item.index, afterText);
          })}
        </AnimatePresence>
        {(activityKind || keepLiveActivitySlot) && (
          <motion.div
            key="live-activity"
            aria-hidden={activityKind ? undefined : true}
            initial={
              activityKind ? { opacity: 0, y: 4, filter: "blur(4px)" } : false
            }
            animate={{
              opacity: activityKind ? 1 : 0,
              y: 0,
              filter: "blur(0px)",
            }}
            transition={{ duration: 0.26, ease: [0.22, 0.61, 0.36, 1] }}
            className={`${liveTopMargin ? "mt-1" : ""} min-h-7`}
          >
            {activityKind ? <LiveActivity kind={activityKind} /> : null}
          </motion.div>
        )}
        <AnimatePresence>
          {sourcesPhaseIdx !== null && openItems.length > 0 && (
            <SourcesModal
              items={openItems}
              onClose={() => setSourcesPhaseIdx(null)}
            />
          )}
          {openThought && (openThought.text?.trim().length ?? 0) > 0 && (
            <ReasoningModal
              text={openThought.text!.trim()}
              durationLabel={`Thought for ${formatDurationSec(openThought.durationMs)}`}
              onClose={() => setReasoningPhaseIdx(null)}
            />
          )}
          {openCalc && (
            <CalcDetailModal
              phase={openCalc}
              onClose={() => setCalcPhaseIdx(null)}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </ArtifactActivityScope>
  );
}

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function faviconUrl(url: string) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?sz=64&domain=${u.hostname}`;
  } catch {
    return undefined;
  }
}

function SourcesModal({
  items,
  onClose,
}: {
  items: SearchSource[];
  onClose: () => void;
}) {
  const capture = useCapture();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      key="sources-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Sources"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh] backdrop-blur-[6px] dark:bg-black/50"
    >
      <motion.div
        key="sources-modal"
        initial={{ opacity: 0, y: -8, scale: 0.97, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -4, scale: 0.98, filter: "blur(4px)" }}
        transition={{
          opacity: { duration: 0.18 },
          filter: { duration: 0.2 },
          y: { type: "spring", stiffness: 360, damping: 30 },
          scale: { type: "spring", stiffness: 360, damping: 30 },
        }}
        className="w-full max-w-xl"
      >
        <ModalCard>
        <div className="flex h-12 items-center gap-2.5 border-b border-black/[0.06] px-3.5 dark:border-white/[0.06]">
          <IconSearch
            size={16}
            stroke={2}
            className="shrink-0 text-neutral-400 dark:text-neutral-500"
          />
          <span className="flex-1 text-[14px] font-medium text-neutral-900 dark:text-neutral-100">
            {items.length} source{items.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
          >
            <IconX size={12} stroke={2.5} />
          </button>
        </div>

        <div className="max-h-[min(60vh,520px)] overflow-y-auto px-1.5 py-1.5">
          <div className="flex flex-col">
            {items.map((s, i) => {
              const host = hostnameOf(s.url);
              const fav = faviconUrl(s.url);
              return (
                <a
                  key={`${s.url}-${i}`}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    capture(ANALYTICS_EVENTS.sourceLinkClicked, {
                      host,
                      position: i,
                      total: items.length,
                    })
                  }
                  className="group/src flex items-start gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/[0.05] dark:bg-white/[0.06]">
                    {fav ? (
                      <img
                        src={fav}
                        alt=""
                        width={16}
                        height={16}
                        className="h-4 w-4 object-contain"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display =
                            "none";
                        }}
                      />
                    ) : (
                      <IconLink
                        size={12}
                        stroke={2}
                        className="text-neutral-500 dark:text-neutral-400"
                      />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                      {s.title}
                    </span>
                    <span className="truncate text-[11.5px] text-neutral-500 dark:text-neutral-400">
                      {host}
                      {s.author ? ` · ${s.author}` : ""}
                      {s.publishedDate
                        ? ` · ${new Date(s.publishedDate).toLocaleDateString()}`
                        : ""}
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
        </div>
        </ModalCard>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function StoppedIndicator() {
  return (
    <div className="mt-1 flex items-center gap-2 py-0.5">
      <span className="flex h-5 w-5 items-center justify-center text-neutral-500 dark:text-neutral-400">
        <span className="h-2.5 w-2.5 rounded-[2px] bg-current" />
      </span>
      <span className="text-[14px] leading-6 text-neutral-500 dark:text-neutral-400">
        Stopped by user
      </span>
    </div>
  );
}

function EditBubble({
  initial,
  isUser,
  onCancel,
  onSave,
}: {
  initial: string;
  isUser: boolean;
  onCancel: () => void;
  onSave: (next: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed !== initial.trim();

  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scale: 0.98, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -4, scale: 0.98, filter: "blur(4px)" }}
      transition={{
        opacity: { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] },
        filter: { duration: 0.2, ease: [0.22, 0.61, 0.36, 1] },
        default: { type: "spring", stiffness: 380, damping: 30 },
      }}
      style={{ transformOrigin: isUser ? "top right" : "top left" }}
      className={`w-full max-w-[80%] min-w-0 ${
        isUser ? "self-end" : "self-start"
      }`}
    >
      <Squircle
        radius={20}
        className="flex flex-col rounded-[20px] border border-black/[0.06] bg-white/75 shadow-[0_4px_16px_rgba(0,0,0,0.06),_0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-[#0c82f2]/20 backdrop-blur-xl backdrop-saturate-150 dark:border-white/[0.06] dark:bg-[#1E1E1E]/75 dark:shadow-[0_4px_16px_rgba(0,0,0,0.4),_0_1px_2px_rgba(0,0,0,0.25)]"
      >
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (canSave) onSave(trimmed);
            }
          }}
          rows={1}
          className="block max-h-60 w-full resize-none overflow-y-auto bg-transparent px-3.5 pt-2.5 pb-1.5 text-[15px] leading-6 text-neutral-900 focus:outline-none dark:text-neutral-100"
        />
        <motion.div
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.06,
            duration: 0.18,
            ease: [0.22, 0.61, 0.36, 1],
          }}
          className="flex items-center justify-between gap-2 px-2 pb-1.5"
        >
          <span className="px-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">
            <kbd className="font-sans">⌘↵</kbd> save ·{" "}
            <kbd className="font-sans">esc</kbd> cancel
          </span>
          <div className="flex items-center gap-1">
            <motion.button
              type="button"
              onClick={onCancel}
              whileTap={{ scale: 0.94 }}
              className="rounded-full px-2.5 py-1 text-[12px] font-medium text-neutral-600 transition-colors hover:bg-black/[0.05] dark:text-neutral-300 dark:hover:bg-white/[0.06]"
            >
              Cancel
            </motion.button>
            <motion.button
              type="button"
              onClick={() => canSave && onSave(trimmed)}
              disabled={!canSave}
              whileTap={canSave ? { scale: 0.94 } : undefined}
              animate={{ opacity: canSave ? 1 : 0.4 }}
              transition={{ duration: 0.15 }}
              className="rounded-full bg-[#0c82f2] px-3 py-1 text-[12px] font-medium text-white shadow-[0_1px_2px_rgba(12,130,242,0.25)] transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:hover:brightness-100"
            >
              Save
            </motion.button>
          </div>
        </motion.div>
      </Squircle>
    </motion.div>
  );
}

function Attachments({
  attachments,
  alignEnd,
  hasText,
}: {
  attachments: Attachment[];
  alignEnd: boolean;
  hasText: boolean;
}) {
  return (
    <div
      className={`flex max-w-[80%] min-w-0 flex-wrap gap-1.5 ${hasText ? "mb-1.5" : ""} ${
        alignEnd ? "justify-end self-end" : "justify-start self-start"
      }`}
    >
      {attachments.map((a) => {
        const kind = attachmentKind(a.name, a.type, a.text != null);
        if (a.url && kind === "image") {
          return <ImageAttachment key={a.id} src={a.url} alt={a.name} />;
        }
        // Text/markdown opens a read-only viewer when we have its contents;
        // anything else (and text we couldn't load) opens in a new tab.
        if (kind === "text" && a.text != null) {
          return <TextAttachment key={a.id} attachment={a} />;
        }
        return <FileAttachment key={a.id} attachment={a} />;
      })}
    </div>
  );
}

function ImageAttachment({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const capture = useCapture();
  return (
    <>
      <AttachmentImageThumb
        src={src}
        alt={alt}
        onClick={() => {
          capture(ANALYTICS_EVENTS.attachmentImageOpened);
          setOpen(true);
        }}
      />
      <AnimatePresence>
        {open && (
          <ImageViewer src={src} alt={alt} onClose={() => setOpen(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * A sent text/markdown attachment. Markdown opens in the rich document sidebar;
 * other plain-text files peek in the read-only preview modal.
 */
function TextAttachment({ attachment }: { attachment: Attachment }) {
  const [open, setOpen] = useState(false);
  const capture = useCapture();
  const { openDocument } = useDocumentSidebar();
  const { addEditedDocument } = useComposerIngest();
  const isMarkdown = isMarkdownAttachment(attachment.name, attachment.type);

  // Editing an already-sent document hands the new text back to the composer as
  // an attachment, so the follow-up message lets whirl see the fresh edits.
  const handleEdit = (markdown: string) => {
    const created = addEditedDocument({
      sourceKey: attachment.id,
      name: attachment.name,
      type: attachment.type,
      text: markdown,
    });
    if (created) {
      capture(ANALYTICS_EVENTS.documentEditsAttached, {
        type: attachment.type,
      });
      showToast({
        message: "added your edits to the composer ✏️",
        tone: "success",
      });
    }
  };

  return (
    <>
      <AttachmentCard
        name={attachment.name}
        type={attachment.type}
        size={attachment.size}
        onClick={() => {
          if (isMarkdown) {
            capture(ANALYTICS_EVENTS.documentSidebarOpened, {
              type: attachment.type,
            });
            openDocument(attachment, handleEdit);
            return;
          }
          capture(ANALYTICS_EVENTS.attachmentPreviewOpened, {
            type: attachment.type,
          });
          setOpen(true);
        }}
      />
      <AnimatePresence>
        {open && (
          <AttachmentPreviewModal
            name={attachment.name}
            type={attachment.type}
            size={attachment.size}
            text={attachment.text ?? ""}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/** A sent non-image, non-text attachment — click to open it in a new tab. */
function FileAttachment({ attachment }: { attachment: Attachment }) {
  const capture = useCapture();
  return (
    <AttachmentCard
      name={attachment.name}
      type={attachment.type}
      size={attachment.size}
      onClick={
        attachment.url
          ? () => {
              capture(ANALYTICS_EVENTS.attachmentOpenedInNewTab, {
                type: attachment.type,
              });
              openInNewTab(attachment.url as string);
            }
          : undefined
      }
    />
  );
}

function MessageActions({
  content,
  alignEnd,
  onEdit,
  onRetry,
  onBranch,
  onRollback,
  addedMemoryIds,
  outputTokens,
  durationMs,
  usageCost,
}: {
  content: string;
  alignEnd: boolean;
  onEdit?: () => void;
  onRetry?: () => void;
  onBranch?: () => void;
  onRollback?: () => void;
  addedMemoryIds?: string[];
  outputTokens?: number;
  durationMs?: number;
  usageCost?: number;
}) {
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<number | null>(null);
  const capture = useCapture();
  const minMd = useMinMd();
  // User messages align to the end; assistant messages to the start.
  const role = alignEnd ? "user" : "assistant";

  useEffect(
    () => () => {
      if (copyResetRef.current != null) {
        window.clearTimeout(copyResetRef.current);
      }
    },
    [],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      if (copyResetRef.current != null) {
        window.clearTimeout(copyResetRef.current);
      }
      setCopied(true);
      copyResetRef.current = window.setTimeout(() => {
        copyResetRef.current = null;
        setCopied(false);
      }, 1500);
      capture(ANALYTICS_EVENTS.messageCopied, {
        role,
        content_length: content.length,
      });
    } catch {
      // clipboard unavailable (insecure context, etc.) — silently ignore
    }
  };

  return (
    <div
      className={`mt-1 flex items-center gap-0.5 transition-opacity duration-150 ${
        minMd
          ? "opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100"
          : "opacity-100"
      } ${alignEnd ? "self-end" : "self-start"}`}
    >
      <ActionButton
        icon={copied ? IconCheck : IconCopy}
        label={copied ? "Copied" : "Copy message"}
        onClick={handleCopy}
      />
      {onEdit && (
        <ActionButton
          icon={IconPencil}
          label="Edit message"
          onClick={() => {
            capture(ANALYTICS_EVENTS.messageEditStarted, { role });
            onEdit();
          }}
        />
      )}
      {onRetry && (
        <ActionButton icon={IconReload} label="Retry" onClick={onRetry} />
      )}
      {onBranch && (
        <CheckpointMenu
          alignEnd={alignEnd}
          onBranch={onBranch}
          onRollback={onRollback}
        />
      )}
      {addedMemoryIds && addedMemoryIds.length > 0 && (
        <MemoryAddedIndicator memoryIds={addedMemoryIds} />
      )}
      {!alignEnd && (
        <MessageStats
          outputTokens={outputTokens}
          durationMs={durationMs}
          usageCost={usageCost}
        />
      )}
    </div>
  );
}

// A long message gets clamped down to this height in its bubble; anything
// taller hides behind a "Show more" toggle so one giant paste can't swallow the
// whole thread.
const COLLAPSED_MESSAGE_PX = 280;

function CollapsibleText({
  content,
  mentionables = [],
}: {
  content: string;
  mentionables?: IntegrationMention[];
}) {
  const capture = useCapture();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () =>
      setOverflowing(el.scrollHeight > COLLAPSED_MESSAGE_PX + 8);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [content]);

  const collapsed = overflowing && !expanded;

  // Mention tokens render as inline pills (logo/thumbnail + name) instead of
  // raw "@name" text. Mention-bearing messages take the plain-text path —
  // splitting Markdown mid-paragraph to splice a pill in would break block
  // flow, and prose with mentions is conversational, not formatted.
  const segments = useMemo(
    () => splitMentionSegments(content, mentionables),
    [content, mentionables],
  );
  const hasMentions = segments.some((segment) => segment.mention);

  return (
    <div className="flex flex-col">
      <div
        ref={ref}
        style={collapsed ? { maxHeight: COLLAPSED_MESSAGE_PX } : undefined}
        className="overflow-hidden"
      >
        {hasMentions ? (
          // Sized to match the Markdown renderer's wrapper exactly, so a
          // message reads the same whether or not it carries a mention.
          <div className="whitespace-pre-wrap text-[16px] leading-[1.7] [overflow-wrap:anywhere]">
            {segments.map((segment, index) =>
              segment.mention ? (
                <InlineMentionPill key={index} mention={segment.mention} />
              ) : (
                <Fragment key={index}>{segment.text}</Fragment>
              ),
            )}
          </div>
        ) : (
          <Markdown content={content} inverted={false} streaming={false} />
        )}
      </div>
      {overflowing && (
        <button
          type="button"
          onClick={() => {
            if (!expanded) {
              capture(ANALYTICS_EVENTS.messageExpanded, {
                content_length: content.length,
              });
            }
            setExpanded((v) => !v);
          }}
          className="mt-1.5 self-start text-[12.5px] font-medium text-[#0c82f2] transition-opacity hover:opacity-80"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
