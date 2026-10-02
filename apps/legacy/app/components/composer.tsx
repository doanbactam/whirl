import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useCustomer } from "autumn-js/react";
import { AnimatePresence, motion } from "motion/react";
import {
  IconBrain,
  IconChevronRight,
  IconCloudUpload,
  IconFileZip,
  IconPaperclip,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconCheck,
} from "@tabler/icons-react";

import { ModelHoverCard } from "~/components/model-hover-card";
import { MobileComposerSheet } from "~/components/mobile-composer-sheet";
import {
  PasteChoiceModal,
  type PasteChoice,
} from "~/components/paste-choice-modal";
import { ComposerAttachments } from "~/components/composer-attachments";
import {
  findMentionedIntegrations,
  splitMentionSegments,
  useMentionableIntegrations,
  useMentionableSkills,
  type IntegrationMention,
} from "~/components/composer-mentions";
import { IntegrationLogo } from "~/components/integrations/integration-logo";
import { useAttachmentUploads } from "~/components/use-attachment-uploads";
import { useComposerIngest } from "~/lib/composer-ingest";
import { takeComposerPrefill } from "~/lib/composer-prefill";
import {
  readAskBeforeBigPastePref,
  setAskBeforeBigPastePref,
} from "~/lib/paste-prompt";
import { Spinner } from "~/components/spinner";
import {
  attachmentRejectionReason,
  modelAcceptsAttachments,
} from "~/lib/attachment-upload";
import { useUpgrade, type GateFeature } from "~/components/upgrade-modal";
import { useMinMd } from "~/lib/use-media";
import { useAuthGate } from "~/lib/auth-gate";
import { readFreeMessages } from "~/lib/messages";
import { isServerOverloaded, useServerLoad } from "~/lib/server-load";
import { ServerOverloadNotice } from "~/components/server-overload";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";
import type { CompactionStatus } from "~/data/threads";
import type { Attachment } from "~/data/messages";
import { modelLabel } from "~/data/models";
import { MODEL_TIERS } from "~/data/model-tiers";
import { useComposerCommandMenu } from "~/components/composer-command-menu";
import {
  dropdownDividerClass,
  dropdownItemClass,
  DropdownShell,
  dropdownShellOpenClass,
} from "~/components/dropdown-menu";
import { MutedPlanBadge, PlanBadge } from "~/components/plan-badge";
import { SquircleUnderlay } from "~/components/squircle";
import { showToast } from "~/data/toasts";

const PLACEHOLDERS = [
  "Ask anything",
  "What's on your mind?",
  "Dream up something wild",
  "Throw me a curveball",
  "Spill it",
  "Let's get weird",
  "Whatcha thinking?",
  "Ask the impossible",
  "What if…",
  "Surprise me",
  "Say something fun",
  "Type like nobody's watching",
  "Pitch me the wildest idea",
  "Go on, I'm all ears",
];

// Past this many pasted characters we stop guessing and ask whether the blob
// should land inline or become a `.md` attachment.
const PASTE_AS_FILE_THRESHOLD = 300;

type ModelKey = "Auto" | "Fast" | "Basic" | "Max" | "Image";

/** Shared frosted surface for the composer shell and related floating controls.
 * One soft shadow, deliberately not a stack: on this translucent, blurred
 * surface a tight second layer reads as a separate outline hugging the border
 * ("onion rings" around the pill's caps, obvious at high zoom / DPR). */
export const COMPOSER_GLASS_SURFACE =
  "border border-black/[0.05] bg-white/35 shadow-[0_3px_14px_rgba(0,0,0,0.05)] backdrop-blur-md backdrop-saturate-150 dark:border-white/[0.05] dark:bg-[#1E1E1E]/38 dark:shadow-[0_3px_16px_rgba(0,0,0,0.38)]";

/** Circular glass control (scroll-to-bottom, etc.). */
export const COMPOSER_GLASS_CONTROL =
  `${COMPOSER_GLASS_SURFACE} transition-colors hover:bg-white/48 dark:hover:bg-[#1E1E1E]/52`;

const SETTINGS_STORAGE_KEY = "whirl:composer-settings";
const VALID_MODELS: readonly ModelKey[] = [
  "Auto",
  "Fast",
  "Basic",
  "Max",
  "Image",
];

function isModelKey(value: unknown): value is ModelKey {
  return typeof value === "string" && (VALID_MODELS as readonly string[]).includes(value);
}

// The Free model (the `Fast` key) is ungated but free-only — paid plans never see it in
// the picker and the server remaps any stray paid send to the Fast tier.
const MODEL_GATE: Record<ModelKey, GateFeature | null> = {
  Auto: "auto",
  Fast: null,
  Basic: "basic",
  Max: "max",
  Image: "image",
};

const PLAN_BADGE_FOR_GATE: Partial<Record<GateFeature, "mini" | "turbo" | "mega">> = {
  auto: "mini",
  can_search: "mini",
  basic: "mini",
  compact: "mini",
  reasoning: "mini",
  max: "turbo",
  image: "turbo",
};

function useFeatureFlags(): {
  flags: Record<GateFeature, boolean>;
  isLoading: boolean;
} {
  const { customer, isLoading } = useCustomer();
  const features = (customer?.features ?? {}) as Record<
    string,
    { unlimited?: boolean; balance?: number; included_usage?: number } | undefined
  >;
  const activeProducts = new Set(
    (customer?.products ?? [])
      .filter((p) => p.status === "active" || p.status === "trialing")
      .map((p) => p.id),
  );
  const has = (id: GateFeature) => {
    const f = features[id];
    if (!f) return false;
    if (f.unlimited) return true;
    if (typeof f.balance === "number" && f.balance > 0) return true;
    if (typeof f.included_usage === "number" && f.included_usage > 0) return true;
    return false;
  };
  const hasAny = (ids: GateFeature[]) => ids.some(has);
  const hasProduct = (ids: string[]) => ids.some((id) => activeProducts.has(id));
  const hasMini = hasAny(["basic", "pro", "max"]) || hasProduct(["mini", "turbo", "mega"]);
  const hasTurbo = hasAny(["pro", "max"]) || hasProduct(["turbo", "mega"]);
  return {
    flags: {
      usage: has("usage"),
      messages: has("messages"),
      can_search: has("can_search") || hasMini,
      auto: hasMini,
      basic: hasMini,
      // Legacy sentinel — no live model uses it, but old gate messages might.
      pro: hasTurbo,
      // Heavy lives on Turbo and up.
      max: hasTurbo,
      // Image generation rides the same tier as Heavy.
      image: hasTurbo,
      // Thinking is on every paid plan.
      reasoning: has("reasoning") || hasMini,
      files: hasMini,
      memory: hasMini,
      mcp: hasMini,
      // Skills ride the same gate as integrations: any paid plan.
      skills: hasMini,
      compact: hasMini,
      // Not a gated toggle — paid plans get priority during server overloads.
      // Kept here so the flags map stays exhaustive over GateFeature.
      priority: hasMini,
    },
    isLoading,
  };
}

// Compact pill above the composer for free users: shows how many of their
// free messages remain and routes them to the upgrade flow.
function FreeMessagesPill({
  above = false,
  lift = false,
}: {
  above?: boolean;
  lift?: boolean;
}) {
  const { customer, isLoading } = useCustomer();
  const { open: openUpgrade } = useUpgrade();
  const { isSignedIn } = useAuthGate();
  const load = useServerLoad();
  const { isFree, remaining, included } = readFreeMessages(customer);

  // Signed-out visitors have no plan/usage — don't show the free-messages pill.
  if (!isSignedIn) return null;
  if (isLoading && !customer) return null;
  if (!isFree) return null;
  // While the server is throttling free users, the overload notice owns this
  // slot — yield so the two pills never float on top of each other.
  if (isServerOverloaded(load)) return null;

  const out = remaining <= 0;
  // In threads the pill sits above the box; when the scroll-to-bottom button
  // is also showing (it anchors to the same spot), lift the pill clear of it.
  const placement = above
    ? lift
      ? "bottom-full mb-14"
      : "bottom-full mb-2"
    : "top-full mt-2";
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-0 flex justify-center ${placement}`}
    >
      <button
        type="button"
        onClick={() => openUpgrade("messages")}
        className={`group pointer-events-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium shadow-sm backdrop-blur transition ${
          out
            ? "border-orange-500/30 bg-orange-500/[0.08] text-orange-700 hover:bg-orange-500/[0.14] dark:text-orange-300"
            : "border-black/[0.08] bg-white/70 text-neutral-600 hover:bg-white dark:border-white/[0.08] dark:bg-[#1E1E1E]/70 dark:text-neutral-300 dark:hover:bg-[#1E1E1E]"
        }`}
      >
        <IconSparkles size={13} stroke={2} />
        <span>
          {out
            ? "You're out of free messages"
            : `${remaining} of ${included} free messages left`}
        </span>
        <span className="font-semibold text-[#0c82f2]">Upgrade</span>
      </button>
    </div>
  );
}

function CompactionBar() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Compacting conversation"
      className={`flex h-11 w-full items-center rounded-[28px] px-4 ${COMPOSER_GLASS_SURFACE}`}
    >
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
        <motion.div
          className="absolute inset-y-0 left-0 w-[38%] rounded-full bg-[#0c82f2]"
          animate={{ x: ["-100%", "280%"] }}
          transition={{
            duration: 1.1,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </div>
    </div>
  );
}

export function Composer({
  onSubmit,
  onStop,
  getAttachmentUploadUrl,
  isGenerating = false,
  variant = "home",
  threadModel,
  onModelChange,
  compactionStatus = "idle",
  onCompact,
  scrollButtonVisible = false,
}: {
  onSubmit?: (
    value: string,
    attachments: Attachment[],
    options: {
      thinking: boolean;
      search: boolean;
      model: ModelKey;
      integrations?: IntegrationMention[];
    },
  ) => void | Promise<void>;
  onStop?: () => void;
  getAttachmentUploadUrl?: () => Promise<string>;
  isGenerating?: boolean;
  variant?: "home" | "thread";
  threadModel?: ModelKey | null;
  onModelChange?: (model: ModelKey) => void;
  compactionStatus?: CompactionStatus;
  onCompact?: () => void;
  scrollButtonVisible?: boolean;
}) {
  const isHome = variant === "home";
  const textSizeClass = isHome
    ? "text-[17px] leading-6"
    : "text-[16px] leading-6";
  const rowHeightClass = isHome ? "h-11" : "h-11";
  const buttonSizeClass = isHome ? "h-11 w-11" : "h-11 w-11";
  const baseRowHeight = isHome ? 44 : 44;
  // The textarea is capped at `max-h-60` (240px) and scrolls past that. The
  // mirror that drives the height has no cap, so without clamping it the field
  // (and the whole composer row) keeps growing while the textarea stays put.
  const maxFieldHeight = 240;
  // Shared timing for the single-line <-> multiline reflow so the textarea
  // height (CSS), border-radius (CSS) and the button glide (motion layout)
  // all move on the same curve instead of fighting each other.
  const reflowTransition = {
    layout: { duration: 0.2, ease: [0.22, 0.61, 0.36, 1] as [number, number, number, number] },
  };

  const { flags, isLoading: featureFlagsLoading } = useFeatureFlags();
  const { customer } = useCustomer();
  const { isFree } = readFreeMessages(customer);
  const { open: openUpgrade } = useUpgrade();
  const capture = useCapture();
  const minMd = useMinMd();

  const [value, setValue] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [textHeight, setTextHeight] = useState(baseRowHeight);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  // The +/model popovers escape the composer's clip while open. Hold the clip
  // open a touch longer than the popover's exit tween so the panel can fade out
  // fully instead of being chopped at the composer edge on close.
  const [popoverEscaping, setPopoverEscaping] = useState(false);
  const [hoveredModel, setHoveredModel] = useState<ModelKey | null>(null);
  const [multiline, setMultiline] = useState(false);
  const [narrowWidth, setNarrowWidth] = useState(0);
  const [fullWidth, setFullWidth] = useState(0);
  // Layout animations must stay off until the composer has mounted and its
  // measurements (width/height/multiline) have settled. Otherwise navigating
  // to a thread captures a stale position and the buttons float outside until
  // the next re-render. Enabled after two frames, once layout is stable.
  const [layoutReady, setLayoutReady] = useState(false);
  const [model, setModel] = useState<ModelKey>("Auto");
  const [thinking, setThinking] = useState(false);
  const [search, setSearch] = useState(false);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pastePrompt, setPastePrompt] = useState<{
    text: string;
    start: number;
    end: number;
  } | null>(null);
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const gaugeRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const textWrapRef = useRef<HTMLDivElement>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const configWrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const hasText = value.trim().length > 0;
  const isAuto = model === "Auto";
  const isImage = model === "Image";
  // Any paid plan unlocks Auto, so the auto flag doubles as "is on a paid plan".
  const isPaidPlan = flags.auto;
  // The `Fast` key is the free tier's Free model — paid plans fall back to Fast instead.
  const baselineModel: ModelKey = isPaidPlan ? "Basic" : "Fast";
  const modelGate = MODEL_GATE[model];
  const canUseModel =
    (modelGate === null || flags[modelGate]) &&
    !(isPaidPlan && model === "Fast");
  const effectiveModel = canUseModel ? model : baselineModel;
  // File uploads are open on every plan; free users are just capped to 1 MB per
  // file, enforced per-file by attachmentRejectionReason via `isFree` (the drop
  // and paste paths already lean on that same check). The only gate left here is
  // whether the effective model accepts *some* attachment type at all.
  const attachDisabledReason = !modelAcceptsAttachments(effectiveModel)
    ? `${modelLabel(effectiveModel)} doesn't support attachments`
    : null;
  const canAttachFiles = attachDisabledReason === null;
  // Image turns neither think nor search — the toggles read as unavailable and
  // the payload always carries false for both.
  const canUseThinking = !isAuto && !isImage && flags.reasoning;
  const canUseSearch = !isAuto && !isImage && flags.can_search;
  // What we hand the model MUST be derived from the exact same gates the
  // toggles render with — otherwise the switch can read "on" while the backend
  // is given "off" (or vice versa). This is the single source of truth for both
  // the switches below and the send payload; never re-gate the payload on
  // `effectiveModel`/some other "auto" check or the two silently drift apart
  // (that desync has been re-introduced here several times). Auto leaves search
  // enabled so the router can look things up when it helps.
  const effectiveThinking = canUseThinking && thinking;
  const effectiveSearch = !isImage && (isAuto || (canUseSearch && search));
  // Attachments upload the moment they're added; this hook owns their lifecycle.
  const uploads = useAttachmentUploads({
    getUploadUrl:
      getAttachmentUploadUrl ??
      (() => Promise.reject(new Error("Attachments aren't available here"))),
    model: effectiveModel,
  });

  // Let edits made elsewhere (e.g. a sent document reopened in the sidebar) drop
  // into this composer's tray, so the next message carries the new text.
  const { registerIngest, registerQuoteInsert } = useComposerIngest();
  const upsertTextDraft = uploads.upsertTextDraft;
  useEffect(() => {
    registerIngest((doc) =>
      upsertTextDraft(doc.sourceKey, {
        name: doc.name,
        type: doc.type,
        text: doc.text,
      }),
    );
    return () => registerIngest(null);
  }, [registerIngest, upsertTextDraft]);

  // Quoted selections from chat messages land at the end of the draft with a
  // blank line under them, caret parked below — ready to reply under the quote.
  useEffect(() => {
    registerQuoteInsert((quote) => {
      setValue((prev) => {
        const settled = prev.replace(/\s+$/, "");
        return settled ? `${settled}\n\n${quote}\n\n` : `${quote}\n\n`;
      });
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      });
      return true;
    });
    return () => registerQuoteInsert(null);
  }, [registerQuoteInsert]);

  useEffect(() => {
    if (menuOpen || configOpen) {
      setPopoverEscaping(true);
      return;
    }
    // Match the popover exit tween (0.12s) plus a hair of slack.
    const t = setTimeout(() => setPopoverEscaping(false), 160);
    return () => clearTimeout(t);
  }, [menuOpen, configOpen]);

  const rejectionFor = (draft: { name: string; type: string; size: number }) =>
    attachmentRejectionReason(draft, effectiveModel, isFree);
  const hasInvalidFiles = uploads.drafts.some(
    (d) => rejectionFor(d) !== null,
  );
  const isCompacting = compactionStatus === "compacting";
  const showCompact = variant === "thread" && Boolean(onCompact);
  const compactLocked = !flags.compact;
  const canSubmit =
    !isCompacting &&
    (hasText || uploads.drafts.length > 0) &&
    !hasInvalidFiles;
  const hasAttachmentChips = uploads.drafts.length > 0;

  // Give the pill row an explicit, CSS-transitioned height. A long line stays a
  // single full-width row, so the textarea never grows to drive the pill taller
  // when the controls drop to a second row — without this the pill would snap.
  // Driving it explicitly lets it glide on the same curve as the textarea and
  // the controls. Constants mirror the Tailwind below: p-1.5 → 12, p-2 → 16,
  // gap-y-1.5 → 6; stacked the row is the field plus the wrapped control row.
  const composerRowHeight =
    (multiline ? 16 : 12) +
    (multiline ? textHeight + 6 + baseRowHeight : textHeight);

  // Installed integrations the user can @mention. Empty (nothing installed,
  // or nothing enabled/connected) hides every mention surface at once.
  const mentionables = useMentionableIntegrations();
  // Installed skills, mentionable the same way — kept as a separate list so
  // the send payload can tell the two kinds apart.
  const skillMentionables = useMentionableSkills();
  // Attached images get positional pseudo-mentions (@img1, @img2, …) so the
  // user can point the model at a specific picture ("put @img1 on top of
  // @img2"). They exist only in the text — never in the integrations payload —
  // and the server resolves them by attachment order, so the numbering here
  // must match the tray order.
  const imageDrafts = useMemo(
    () => uploads.drafts.filter((d) => d.type.startsWith("image/")),
    [uploads.drafts],
  );
  const imageTagMentions = useMemo<IntegrationMention[]>(
    () =>
      imageDrafts.map((d) => ({
        serverId: `image-tag:${d.id}`,
        name: d.name,
        // The draft's thumbnail rides as the "logo", so the mention pill and
        // the command menu both show the actual picture.
        logoUrl: d.previewUrl ?? null,
      })),
    [imageDrafts],
  );
  // Mentions live inline in the text as "@Name" — derived, never stored. The
  // segments drive the highlight backdrop; the send payload dedupes them.
  const mentionSegments = useMemo(
    () =>
      splitMentionSegments(value, [
        ...mentionables,
        ...skillMentionables,
        ...imageTagMentions,
      ]),
    [value, mentionables, skillMentionables, imageTagMentions],
  );
  const hasInlineMentions = mentionSegments.some((s) => s.mention);
  const captureMention = (
    mention: IntegrationMention,
    kind: "integration" | "skill",
    source: "command_menu" | "plus_menu" | "mobile_sheet",
  ) =>
    capture(
      kind === "skill"
        ? ANALYTICS_EVENTS.skillMentioned
        : ANALYTICS_EVENTS.integrationMentioned,
      kind === "skill"
        ? { skill: mention.name, source }
        : { integration: mention.name, source },
    );
  // The plus menu / mobile sheet path: drop "@Name " into the text at the
  // caret (with a space each side so the token parses), then restore focus.
  const insertMention = (
    mention: IntegrationMention,
    kind: "integration" | "skill",
    source: "plus_menu" | "mobile_sheet",
  ) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const inserted = `${lead}@${mention.name}${after.startsWith(" ") ? "" : " "}`;
    setValue(before + inserted + after);
    const caret = start + inserted.length;
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
    captureMention(mention, kind, source);
  };

  const commandMenu = useComposerCommandMenu({
    value,
    setValue,
    textareaRef,
    model,
    thinking,
    search,
    flags,
    isAuto,
    setModel,
    onModelChange,
    setThinking,
    setSearch,
    openUpgrade,
    canCompact: showCompact,
    compactLocked,
    onCompact,
    compactionActive: isCompacting,
    integrations: mentionables,
    skills: skillMentionables,
    // The menu writes the "@Name " token itself; these are analytics only.
    onMentionIntegration: (mention) =>
      captureMention(mention, "integration", "command_menu"),
    onMentionSkill: (mention) =>
      captureMention(mention, "skill", "command_menu"),
    isImage,
    imageTags: imageDrafts.map((d) => ({
      name: d.name,
      previewUrl: d.previewUrl,
    })),
  });

  useEffect(() => {
    if (commandMenu.isOpen) {
      setMenuOpen(false);
      setConfigOpen(false);
    }
  }, [commandMenu.isOpen]);

  const addFiles = uploads.addFiles;
  const openFilePicker = () => fileInputRef.current?.click();

  const resolvePaste = (choice: PasteChoice, dontAskAgain: boolean) => {
    const prompt = pastePrompt;
    setPastePrompt(null);
    if (!prompt) return;
    // The tickbox means "skip this dialog forever" — future big pastes land
    // inline as plain text, same as choosing "message" every time.
    if (dontAskAgain) setAskBeforeBigPastePref(false);
    capture(ANALYTICS_EVENTS.longPasteResolved, {
      choice,
      char_count: prompt.text.length,
      dont_ask_again: dontAskAgain,
    });
    if (choice === "message") {
      setValue(
        (v) => v.slice(0, prompt.start) + prompt.text + v.slice(prompt.end),
      );
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const caret = prompt.start + prompt.text.length;
        el.setSelectionRange(caret, caret);
      });
      return;
    }
    const file = new File([prompt.text], "pasted-text.md", {
      type: "text/markdown",
    });
    addFiles([file]);
  };

  const submit = async () => {
    if (isCompacting || isGenerating || submitting || !canSubmit) return;
    const trimmed = value.trim();
    setSubmitting(true);
    try {
      // Files have been uploading since they were added — wait for any still in
      // flight, then drop anything this model won't accept.
      const ready = await uploads.resolveAttachments();
      const toSend = ready.filter(
        (a) => attachmentRejectionReason(a, effectiveModel, isFree) === null,
      );
      if (!trimmed && toSend.length === 0) {
        if (uploads.drafts.length > 0) {
          showToast({
            message: "Those attachments can't be sent to this model.",
            tone: "danger",
          });
        }
        return;
      }
      const mentioned = findMentionedIntegrations(trimmed, mentionables);
      const mentionedSkills = findMentionedIntegrations(
        trimmed,
        skillMentionables,
      );
      const taggedImages = findMentionedIntegrations(trimmed, imageTagMentions);
      if (taggedImages.length > 0) {
        capture(ANALYTICS_EVENTS.imageTagMentioned, {
          count: taggedImages.length,
          model: effectiveModel,
        });
      }
      await onSubmit?.(trimmed, toSend, {
        thinking: effectiveThinking,
        search: effectiveSearch,
        model: effectiveModel,
        ...(mentioned.length > 0 ? { integrations: mentioned } : {}),
        // Skill mentions carry the install id under the mention shape's
        // generic `serverId` key — restore its real name for the payload.
        ...(mentionedSkills.length > 0
          ? {
              skills: mentionedSkills.map((m) => ({
                installId: m.serverId,
                name: m.name,
                logoUrl: m.logoUrl,
                iconSvg: m.iconSvg,
              })),
            }
          : {}),
      });
      setValue("");
      uploads.clear();
      commandMenu.close();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong";
      showToast({ message: msg, tone: "danger" });
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    setOverlayHost(document.getElementById("content-pane"));
  }, []);

  // The /about hero composer stashes its prompt before hopping here; seed the
  // field with it so the visitor lands mid-thought, ready to send.
  useEffect(() => {
    if (!isHome) return;
    const prefill = takeComposerPrefill();
    if (prefill) {
      setValue(prefill);
      textareaRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          model?: unknown;
          thinking?: unknown;
          search?: unknown;
        };
        if (isModelKey(parsed.model)) setModel(parsed.model);
        if (typeof parsed.thinking === "boolean") setThinking(parsed.thinking);
        if (typeof parsed.search === "boolean") setSearch(parsed.search);
      }
    } catch {
      // localStorage unavailable or corrupt — fall back to defaults
    }
    setSettingsHydrated(true);
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    try {
      localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({ model, thinking, search }),
      );
    } catch {
      // storage full / disabled — silently ignore
    }
  }, [settingsHydrated, model, thinking, search]);

  useEffect(() => {
    if (!settingsHydrated || !threadModel) return;
    if (isModelKey(threadModel)) setModel(threadModel);
  }, [settingsHydrated, threadModel]);

  useEffect(() => {
    if (!settingsHydrated || featureFlagsLoading) return;
    const gate = MODEL_GATE[model];
    if (gate && !flags[gate]) setModel(baselineModel);
    // The Free model is free-only — a paid user carrying it (stale localStorage, an old
    // thread) slides over to their Fast tier.
    if (isPaidPlan && model === "Fast") {
      setModel("Basic");
      capture(ANALYTICS_EVENTS.modelSelected, {
        model: "Basic",
        source: "paid_free_model_migration",
      });
    }
  }, [settingsHydrated, featureFlagsLoading, model, flags]);

  useEffect(() => {
    if (!settingsHydrated || featureFlagsLoading) return;
    if (!canUseThinking && thinking) setThinking(false);
    if (!canUseSearch && search) setSearch(false);
  }, [
    settingsHydrated,
    featureFlagsLoading,
    canUseThinking,
    canUseSearch,
    thinking,
    search,
  ]);

  useEffect(() => {
    if (!settingsHydrated || !isAuto) return;
    if (thinking) setThinking(false);
    if (search) setSearch(false);
  }, [settingsHydrated, isAuto, thinking, search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setValue((v) => v + e.key);
      textareaRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Measure the textarea height synchronously, before the browser paints, so it
  // tracks the text with no lagged in-between frame. (The old async
  // ResizeObserver read meant the CSS height transition animated from a stale
  // value — that frame of drift is what felt janky.) The CSS `transition-height`
  // on the textarea does the actual smooth grow.
  const measureHeight = useCallback(() => {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    // Ignore 0-height reads (a measurement that lands before the row has real
    // layout, e.g. right after a route change) so we never pin the field to a
    // wrong height and strand the text off-centre.
    const h = mirror.offsetHeight;
    if (h > 0) setTextHeight(Math.min(h, maxFieldHeight));
  }, [maxFieldHeight]);

  useLayoutEffect(() => {
    measureHeight();
  }, [value, measureHeight, fullWidth]);

  // Keep the mention highlight aligned when the text changes programmatically
  // (menu insertions can scroll the textarea without firing onScroll first).
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const highlight = highlightRef.current;
    if (ta && highlight) highlight.scrollTop = ta.scrollTop;
  }, [value, textHeight, hasInlineMentions]);

  useEffect(() => {
    const wrap = textWrapRef.current;
    if (!wrap) return;
    const raf = requestAnimationFrame(measureHeight);
    document.fonts?.ready.then(measureHeight).catch(() => {});
    const observer = new ResizeObserver(measureHeight);
    observer.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [measureHeight]);

  // Track the single-row width so the gauge can decide when to stack without
  // oscillating once the field widens to full width.
  useEffect(() => {
    const el = textWrapRef.current;
    if (!el) return;
    const update = () => {
      if (!multiline) setNarrowWidth(el.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [multiline]);

  // Track the width the field spans once it's stacked on its own row, and pin
  // the height mirror to it. We measure height against THIS width — never the
  // field's current (possibly narrow) inline width — so a long line that will
  // fit on one full-width row never measures as two lines and bounces, while a
  // real newline still grows the box immediately. It's the row's content box,
  // so subtract the stacked horizontal padding (p-2 → 8px a side).
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const update = () => setFullWidth(Math.max(0, el.clientWidth - 16));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Decide inline-vs-stacked from a gauge pinned to the single-row width. This
  // runs as an ordinary post-paint effect (not the synchronous layout pass
  // above) on purpose: Framer's layout animation only animates the stack reflow
  // when the change lands across a paint boundary. Folding it into the
  // pre-paint measurement made the box snap straight to the stacked state.
  useEffect(() => {
    const el = gaugeRef.current;
    if (!el) return;
    const update = () => setMultiline(el.offsetHeight > baseRowHeight + 8);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [baseRowHeight]);

  // Turn on layout animations only after mount + initial measurements settle,
  // so navigating to a thread doesn't animate the controls from a stale spot.
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setLayoutReady(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);
  // Each control (+ button, model picker, send) is its OWN standalone layout
  // element so it glides to its stacked-row spot. They are deliberately NOT
  // projected through the row/field wrappers: the row's height is animated by
  // CSS (outside Framer's knowledge), and projecting the controls through that
  // animating box makes Framer give up and snap them. The wrappers therefore
  // carry no layout prop; the field's width simply jumps to full (fine — it's
  // covered by the controls sliding down and the pill growing on one curve).
  const controlLayout = layoutReady;

  useEffect(() => {
    // Only rotate while the field is empty — rotating the key behind typed
    // text churns AnimatePresence and can strand the exiting placeholder.
    if (!isHome || value !== "") return;
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length);
    }, 5000);
    return () => clearInterval(id);
  }, [isHome]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!configOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        configWrapRef.current &&
        !configWrapRef.current.contains(e.target as Node)
      ) {
        setConfigOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfigOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [configOpen]);

  useEffect(() => {
    if (!configOpen) setHoveredModel(null);
  }, [configOpen]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = e.clipboardData?.files;
      if (pasted && pasted.length > 0) {
        e.preventDefault();
        addFiles(pasted);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounterRef.current += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setDragging(false);
      addFiles(e.dataTransfer?.files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <div className="relative w-full">
      {overlayHost &&
        createPortal(
          <AnimatePresence>
            {dragging && (
              <motion.div
                key="drop-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[28px] border-2 border-dashed border-[#0c82f2] bg-[#0c82f2]/[0.06] backdrop-blur-[2px] dark:bg-[#0c82f2]/[0.12]"
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 340, damping: 26 }}
                  className="flex flex-col items-center gap-2 text-[#0c82f2]"
                >
                  <IconCloudUpload size={36} stroke={1.5} />
                  <div className="text-sm font-medium">Drop files to attach</div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          overlayHost,
        )}
      {isCompacting ? (
        <CompactionBar />
      ) : (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="w-full"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <label
          htmlFor="home-input"
          className="relative isolate flex w-full cursor-text flex-col"
        >
          {/* The glass surface lives on a clipped underlay so the label itself
              stays unclipped — its popovers and pills hang outside the pill. */}
          <SquircleUnderlay
            radius={multiline ? 24 : 28}
            className={`${COMPOSER_GLASS_SURFACE} transition-[border-radius,clip-path] duration-200 ${
              multiline ? "rounded-[24px]" : "rounded-[28px]"
            }`}
          />
          <AnimatePresence initial={false}>
            {hasAttachmentChips && (
              <motion.div
                key="attachment-chips"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
                className="overflow-hidden"
              >
                <ComposerAttachments
                  drafts={uploads.drafts}
                  rejectionReason={rejectionFor}
                  onRemove={uploads.remove}
                  onEditText={uploads.updateText}
                />
              </motion.div>
            )}
          </AnimatePresence>
          <div
            ref={rowRef}
            style={{ height: composerRowHeight }}
            className={`flex w-full flex-wrap content-start items-center gap-y-1.5 transition-[height] duration-200 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
              multiline ? "p-2" : "p-1.5"
            } ${
              // Clip while morphing so a control that snaps to the stacked row
              // can't hang outside the pill before the height catches up; the
              // height transition then reveals it. Only the +/model popovers are
              // meant to escape this row, and they open on click, never mid-type.
              popoverEscaping ? "overflow-visible" : "overflow-hidden"
            }`}
          >
            <motion.div
              ref={menuWrapRef}
              layout={controlLayout}
              transition={reflowTransition}
              className={`relative ${multiline ? "order-2 mr-auto" : ""}`}
            >
              <motion.button
                type="button"
                aria-label="Add"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => {
                  commandMenu.close();
                  setConfigOpen(false);
                  if (!minMd) {
                    setMobileSheetOpen((v) => !v);
                    return;
                  }
                  setMenuOpen((v) => !v);
                }}
                whileTap={{ scale: 0.98 }}
                animate={{ rotate: menuOpen ? 45 : 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 26 }}
                className={`depth-neutral flex ${buttonSizeClass} shrink-0 items-center justify-center rounded-full text-neutral-600 dark:text-neutral-300`}
              >
                <IconPlus size={16} stroke={2} />
              </motion.button>

              <AnimatePresence>
                {minMd && menuOpen && (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: 6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{
                      opacity: 0,
                      y: 6,
                      scale: 0.96,
                      transition: { duration: 0.12, ease: "easeOut" },
                    }}
                    transition={{ type: "spring", stiffness: 380, damping: 28 }}
                    style={{ transformOrigin: "bottom left" }}
                    className="absolute bottom-full left-0 z-20 mb-2 flex items-end gap-1.5"
                  >
                    <DropdownShell className="w-56">
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!canAttachFiles}
                        title={attachDisabledReason ?? undefined}
                        onClick={() => {
                          if (!canAttachFiles) return;
                          setMenuOpen(false);
                          openFilePicker();
                        }}
                        className={dropdownItemClass}
                      >
                        <IconPaperclip
                          size={16}
                          stroke={2}
                          className="text-neutral-500 dark:text-neutral-400"
                        />
                        <span className="flex-1">Attach</span>
                      </button>

                      {showCompact && (
                        <div className="group/compact relative">
                          <button
                            type="button"
                            role="menuitem"
                            disabled={isCompacting}
                            onClick={() => {
                              setMenuOpen(false);
                              if (compactLocked) {
                                openUpgrade("compact");
                                return;
                              }
                              onCompact?.();
                            }}
                            className={dropdownItemClass}
                          >
                            <IconFileZip
                              size={16}
                              stroke={2}
                              className="text-neutral-500 dark:text-neutral-400"
                            />
                            <span className="flex-1">Compact thread</span>
                            {compactLocked ? <PlanBadge plan="mini" /> : null}
                          </button>
                          <span
                            role="tooltip"
                            className="pointer-events-none absolute left-full top-1/2 z-10 ml-2 w-[200px] -translate-y-1/2 scale-95 whitespace-normal rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium leading-snug text-white opacity-0 shadow-sm transition-[opacity,transform] duration-150 group-hover/compact:scale-100 group-hover/compact:opacity-100 group-focus-within/compact:scale-100 group-focus-within/compact:opacity-100 dark:bg-neutral-100 dark:text-neutral-900"
                          >
                            Sums up the conversation so far to free up room for more
                          </span>
                        </div>
                      )}

                      {mentionables.length > 0 && (
                        <>
                          <div className={dropdownDividerClass} />
                          <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                            Mention an integration
                          </div>
                          {mentionables.map((mention) => (
                            <button
                              key={mention.serverId}
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setMenuOpen(false);
                                insertMention(mention, "integration", "plus_menu");
                              }}
                              className={dropdownItemClass}
                            >
                              <IntegrationLogo
                                name={mention.name}
                                logoUrl={mention.logoUrl}
                                iconSvg={mention.iconSvg}
                                size={18}
                              />
                              <span className="flex-1 truncate">
                                {mention.name}
                              </span>
                            </button>
                          ))}
                        </>
                      )}
                      {skillMentionables.length > 0 && (
                        <>
                          <div className={dropdownDividerClass} />
                          <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                            Mention a skill
                          </div>
                          {skillMentionables.map((mention) => (
                            <button
                              key={mention.serverId}
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setMenuOpen(false);
                                insertMention(mention, "skill", "plus_menu");
                              }}
                              className={dropdownItemClass}
                            >
                              <IntegrationLogo
                                name={mention.name}
                                logoUrl={mention.logoUrl}
                                iconSvg={mention.iconSvg}
                                size={18}
                              />
                              <span className="flex-1 truncate">
                                {mention.name}
                              </span>
                            </button>
                          ))}
                        </>
                      )}
                    </DropdownShell>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
            <div
              ref={textWrapRef}
              className={`relative min-w-0 ${isHome ? "min-h-11" : "min-h-10"} ${
                multiline ? "order-first basis-full" : "flex-1"
              }`}
            >
              {/* Mention rendering: a metrics-identical layer behind the
                  textarea (same trick as the height mirrors). While a mention
                  is live the textarea's own glyphs go transparent and THIS
                  layer draws all the text — plain runs in the normal color,
                  mentions as a tinted pill with blue text and the
                  integration's logo drawn inside the "@" glyph's cell.
                  Only colors change (never weight or spacing), so the layout
                  the textarea computes for caret/wrap/selection still matches
                  what's on screen, pixel for pixel. Scroll is synced below. */}
              {hasInlineMentions && (
                <div
                  ref={highlightRef}
                  aria-hidden
                  className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2.5 ${textSizeClass} text-neutral-900 dark:text-neutral-100`}
                >
                  {mentionSegments.map((segment, index) =>
                    segment.mention ? (
                      // Real padding would shift glyphs out of sync with the
                      // textarea's layout, so the pill's breathing room is a
                      // zero-blur shadow spread: same tint painted 3px past
                      // the text box, no metric change. The logo sits in the
                      // "@" glyph's cell, nudged left so it isn't kissing the
                      // first letter.
                      <span
                        key={index}
                        className="rounded-[6px] box-decoration-clone bg-[#0c82f2]/[0.1] text-[#0c82f2] shadow-[0_0_0_3px_rgba(12,130,242,0.1)] dark:bg-[#0c82f2]/[0.22] dark:text-[#6db4f8] dark:shadow-[0_0_0_3px_rgba(12,130,242,0.22)]"
                      >
                        <span className="relative text-transparent">
                          @
                          {/* Wrapper owns the absolute placement — the logo's
                              image branch is position:relative under the hood
                              and would fragment the line box if left in flow,
                              desyncing this layer from the textarea. */}
                          <span className="absolute left-[44%] top-[53%] -translate-x-1/2 -translate-y-1/2">
                            <IntegrationLogo
                              name={segment.mention.name}
                              logoUrl={segment.mention.logoUrl}
                              iconSvg={segment.mention.iconSvg}
                              size={13}
                            />
                          </span>
                        </span>
                        {segment.text.slice(1)}
                      </span>
                    ) : (
                      <Fragment key={index}>{segment.text}</Fragment>
                    ),
                  )}
                  {value.endsWith("\n") ? " " : ""}
                </div>
              )}
              <textarea
                ref={textareaRef}
                id="home-input"
                rows={1}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  commandMenu.refresh();
                }}
                onSelect={commandMenu.refresh}
                onClick={commandMenu.refresh}
                onFocus={commandMenu.refresh}
                onPaste={(e) => {
                  // Files ride the document-level paste listener; only long
                  // text gets the inline-vs-attachment prompt.
                  if ((e.clipboardData.files?.length ?? 0) > 0) return;
                  const text = e.clipboardData.getData("text");
                  if (text.length <= PASTE_AS_FILE_THRESHOLD) return;
                  // Opted out of the dialog — let the native paste land the
                  // text inline like any small paste would.
                  if (!readAskBeforeBigPastePref()) return;
                  e.preventDefault();
                  const el = e.currentTarget;
                  setPastePrompt({
                    text,
                    start: el.selectionStart ?? value.length,
                    end: el.selectionEnd ?? value.length,
                  });
                  capture(ANALYTICS_EVENTS.longPastePrompted, {
                    char_count: text.length,
                  });
                }}
                onKeyDown={(e) => {
                  if (commandMenu.onKeyDown(e)) return;
                  // On mobile, Enter should add a newline, not fire off the
                  // message — sending is reserved for the send button.
                  if (
                    minMd &&
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    submit();
                  }
                }}
                onScroll={(e) => {
                  const highlight = highlightRef.current;
                  if (highlight) highlight.scrollTop = e.currentTarget.scrollTop;
                }}
                style={{ height: textHeight }}
                className={`relative block max-h-60 w-full resize-none overflow-y-auto bg-transparent px-3 ${isHome ? "py-2.5" : "py-2.5"} ${textSizeClass} ${
                  // While a mention is on screen the backdrop layer draws the
                  // glyphs (so it can color them); the textarea keeps only the
                  // caret and selection. Identical metrics, so no shift.
                  hasInlineMentions
                    ? "text-transparent"
                    : "text-neutral-900 dark:text-neutral-100"
                } caret-neutral-900 transition-[height] duration-200 ease-[cubic-bezier(0.22,0.61,0.36,1)] focus:outline-none dark:caret-neutral-100`}
              />
              <div
                ref={mirrorRef}
                aria-hidden
                style={{
                  width: fullWidth > 0 ? fullWidth : textWrapRef.current?.clientWidth,
                }}
                className={`pointer-events-none invisible absolute left-0 top-0 whitespace-pre-wrap break-words px-3 py-2.5 ${textSizeClass}`}
              >
                {value === "" ? " " : value}
                {value.endsWith("\n") ? " " : ""}
              </div>
              <div
                ref={gaugeRef}
                aria-hidden
                style={{
                  width: narrowWidth > 0 ? narrowWidth : textWrapRef.current?.clientWidth,
                }}
                className={`pointer-events-none invisible absolute left-0 top-0 whitespace-pre-wrap break-words px-3 py-2.5 ${textSizeClass}`}
              >
                {value === "" ? " " : value}
                {value.endsWith("\n") ? " " : ""}
              </div>
              <AnimatePresence initial={false}>
                {!hasText && (
                  <motion.span
                    key={isHome ? placeholderIdx : "static"}
                    initial={isHome ? { opacity: 0, y: 6 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    exit={isHome ? { opacity: 0, y: -6 } : { opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
                    className={`pointer-events-none absolute inset-x-0 top-0 flex ${rowHeightClass} items-center px-3 ${textSizeClass} text-neutral-400 dark:text-neutral-500`}
                  >
                    {isHome ? PLACEHOLDERS[placeholderIdx] : ""}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            {minMd && (
            <div
              ref={configWrapRef}
              className={`relative shrink-0 ${multiline ? "order-3" : ""}`}
            >
              {/* The button carries its own layout animation so it glides
                  during reflow and smoothly resizes when the label swaps.
                  border-radius is set inline so Framer corrects the pill's caps
                  during the size animation instead of stretching them; the
                  label/icons are scale-corrected (layout="position") so they
                  stay crisp. The popover is a sibling, so it's never distorted. */}
              <motion.button
                type="button"
                layout={controlLayout}
                transition={reflowTransition}
                style={{ borderRadius: 18 }}
                aria-label="Model and tools"
                aria-haspopup="menu"
                aria-expanded={configOpen}
                onClick={() => {
                  setConfigOpen((v) => {
                    if (!v) commandMenu.close();
                    return !v;
                  });
                  setMenuOpen(false);
                }}
                whileTap={{ scale: 0.98 }}
                className={`relative mr-1 flex h-9 items-center gap-1.5 px-3 text-[13px] font-medium text-neutral-500 transition-colors hover:bg-black/[0.04] hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-white/[0.05] dark:hover:text-neutral-200 ${
                  configOpen
                    ? "bg-black/[0.04] text-neutral-700 dark:bg-white/[0.05] dark:text-neutral-200"
                    : ""
                }`}
              >
                {/* The label swaps with a soft blur/slide and the tool icons
                    pop in and out, so changing the model or toggling thinking/
                    search reads as a little animation rather than a hard cut. */}
                <span className="relative inline-flex">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={model}
                      layout="position"
                      initial={{ opacity: 0, y: 7, filter: "blur(3px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, y: -7, filter: "blur(3px)" }}
                      transition={{
                        opacity: { duration: 0.18 },
                        filter: { duration: 0.18 },
                        y: { type: "spring", stiffness: 520, damping: 34 },
                        layout: reflowTransition.layout,
                      }}
                      className="whitespace-nowrap"
                    >
                      {modelLabel(model)}
                    </motion.span>
                  </AnimatePresence>
                </span>
                <AnimatePresence mode="popLayout" initial={false}>
                  {thinking && (
                    <motion.span
                      key="thinking"
                      layout="position"
                      initial={{ opacity: 0, scale: 0.4 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.4 }}
                      transition={{
                        type: "spring",
                        stiffness: 520,
                        damping: 30,
                        layout: reflowTransition.layout,
                      }}
                      className="flex"
                    >
                      <IconBrain
                        size={13}
                        stroke={2}
                        className="text-neutral-500 dark:text-neutral-400"
                      />
                    </motion.span>
                  )}
                  {search && (
                    <motion.span
                      key="search"
                      layout="position"
                      initial={{ opacity: 0, scale: 0.4 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.4 }}
                      transition={{
                        type: "spring",
                        stiffness: 520,
                        damping: 30,
                        layout: reflowTransition.layout,
                      }}
                      className="flex"
                    >
                      <IconSearch
                        size={13}
                        stroke={2}
                        className="text-neutral-500 dark:text-neutral-400"
                      />
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>

              <AnimatePresence>
                {configOpen && (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: 6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{
                      opacity: 0,
                      y: 6,
                      scale: 0.96,
                      transition: { duration: 0.12, ease: "easeOut" },
                    }}
                    transition={{ type: "spring", stiffness: 380, damping: 28 }}
                    style={{ transformOrigin: "bottom right" }}
                    className={`absolute bottom-full right-0 z-20 mb-2 w-60 overflow-visible ${dropdownShellOpenClass}`}
                  >
                    <div
                      className="relative"
                      onMouseLeave={() => setHoveredModel(null)}
                    >
                      <ModelHoverCard
                        model={hoveredModel}
                        className="absolute right-full top-1/2 z-10 mr-3 -translate-y-1/2"
                      />
                      {/* Image isn't really a tier — it lives in its own
                          section under a divider so the text models read as
                          one family and pictures as another. */}
                      {MODEL_TIERS.filter(
                        (m) => !(isPaidPlan && m.key === "Fast"),
                      ).map((m) => {
                      const selected = model === m.key;
                      const gate = MODEL_GATE[m.key];
                      const locked = gate !== null && !flags[gate];
                      const Glyph = m.icon;
                      return (
                        <div key={m.key}>
                        {m.key === "Image" && (
                          <div className={dropdownDividerClass} />
                        )}
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          onMouseEnter={() => setHoveredModel(m.key)}
                          onFocus={() => setHoveredModel(m.key)}
                          onBlur={() => setHoveredModel(null)}
                          onClick={() => {
                            if (locked && gate) {
                              openUpgrade(gate);
                              return;
                            }
                            setModel(m.key);
                            onModelChange?.(m.key);
                            capture(ANALYTICS_EVENTS.modelSelected, {
                              model: m.key,
                              source: "composer_menu",
                            });
                          }}
                          className={dropdownItemClass}
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                            <Glyph
                              size={16}
                              stroke={2}
                              className="text-neutral-500 dark:text-neutral-400"
                            />
                          </span>
                          <span
                            className={`flex-1 text-[13px] font-medium ${
                              locked
                                ? "text-neutral-400 dark:text-neutral-500"
                                : "text-neutral-900 dark:text-neutral-100"
                            }`}
                          >
                            {modelLabel(m.key)}
                          </span>
                          {locked ? (
                            <MutedPlanBadge plan={PLAN_BADGE_FOR_GATE[gate!]!} />
                          ) : (
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                              {selected && (
                                <IconCheck
                                  size={14}
                                  stroke={2.5}
                                  className="text-[#0c82f2]"
                                />
                              )}
                            </span>
                          )}
                        </button>
                        </div>
                      );
                    })}
                    </div>

                    <div className={dropdownDividerClass} />

                    <div className="group/toggle relative">
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={canUseThinking ? thinking : false}
                      aria-disabled={!canUseThinking}
                      onClick={() => {
                        if (isAuto || isImage) return;
                        if (!flags.reasoning) {
                          openUpgrade("reasoning");
                          return;
                        }
                        setThinking((v) => !v);
                        capture(ANALYTICS_EVENTS.thinkingToggled, {
                          enabled: !thinking,
                          source: "composer_menu",
                        });
                      }}
                      className={`${dropdownItemClass} ${
                        !canUseThinking ? "cursor-default" : ""
                      }`}
                    >
                      <IconBrain
                        size={16}
                        stroke={2}
                        className="text-neutral-500 dark:text-neutral-400"
                      />
                      <span className="flex-1">Thinking</span>
                      {isAuto ? (
                        <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                          Auto
                        </span>
                      ) : isImage ? (
                        <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                          Off
                        </span>
                      ) : !flags.reasoning ? (
                        <MutedPlanBadge plan="turbo" />
                      ) : (
                        <span
                          aria-hidden
                          className={`relative h-[18px] w-[30px] rounded-full transition-colors duration-200 ${
                            thinking
                              ? "bg-[#0c82f2]"
                              : "bg-neutral-300 dark:bg-neutral-700"
                          }`}
                        >
                          <motion.span
                            className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
                            animate={{ x: thinking ? 14 : 2 }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                          />
                        </span>
                      )}
                    </button>
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute right-full top-1/2 z-10 mr-2 w-[200px] -translate-y-1/2 scale-95 whitespace-normal rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium leading-snug text-white opacity-0 shadow-sm transition-[opacity,transform] duration-150 group-hover/toggle:scale-100 group-hover/toggle:opacity-100 dark:bg-neutral-100 dark:text-neutral-900"
                    >
                      {isAuto
                        ? "Auto picks when to slow down and think things through"
                        : isImage
                          ? "Image doesn't think in words — it goes straight to pixels"
                          : "Takes a little longer, but works through tricky stuff more carefully"}
                    </span>
                    </div>

                    <div className="group/toggle relative">
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={canUseSearch ? search : false}
                      aria-disabled={!canUseSearch}
                      onClick={() => {
                        if (isAuto || isImage) return;
                        if (!flags.can_search) {
                          openUpgrade("can_search");
                          return;
                        }
                        setSearch((v) => !v);
                        capture(ANALYTICS_EVENTS.searchToggled, {
                          enabled: !search,
                          source: "composer_menu",
                        });
                      }}
                      className={`${dropdownItemClass} ${
                        !canUseSearch ? "cursor-default" : ""
                      }`}
                    >
                      <IconSearch
                        size={16}
                        stroke={2}
                        className="text-neutral-500 dark:text-neutral-400"
                      />
                      <span className="flex-1">Search</span>
                      {isAuto ? (
                        <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                          Auto
                        </span>
                      ) : isImage ? (
                        <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                          Off
                        </span>
                      ) : !flags.can_search ? (
                        <MutedPlanBadge plan="mini" />
                      ) : (
                        <span
                          aria-hidden
                          className={`relative h-[18px] w-[30px] rounded-full transition-colors duration-200 ${
                            search
                              ? "bg-[#0c82f2]"
                              : "bg-neutral-300 dark:bg-neutral-700"
                          }`}
                        >
                          <motion.span
                            className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
                            animate={{ x: search ? 14 : 2 }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                          />
                        </span>
                      )}
                    </button>
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute right-full top-1/2 z-10 mr-2 w-[200px] -translate-y-1/2 scale-95 whitespace-normal rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium leading-snug text-white opacity-0 shadow-sm transition-[opacity,transform] duration-150 group-hover/toggle:scale-100 group-hover/toggle:opacity-100 dark:bg-neutral-100 dark:text-neutral-900"
                    >
                      {isAuto
                        ? "Auto looks things up on the web when it helps"
                        : isImage
                          ? "Image paints from imagination, not the web"
                          : "Lets the answer pull in fresh info from the web"}
                    </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            )}
            <motion.button
              layout={controlLayout}
              transition={reflowTransition}
              type={isGenerating || submitting ? "button" : "submit"}
              aria-label={
                submitting ? "Sending" : isGenerating ? "Stop" : "Send"
              }
              onClick={
                isGenerating
                  ? (e) => {
                      e.preventDefault();
                      onStop?.();
                    }
                  : undefined
              }
              disabled={submitting || (!isGenerating && !canSubmit)}
              whileTap={
                !submitting && (isGenerating || canSubmit)
                  ? { scale: 0.98 }
                  : undefined
              }
              className={`depth-neutral relative flex ${buttonSizeClass} shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${
                multiline ? "order-4 " : ""
              }${
                isGenerating || canSubmit || submitting
                  ? "text-white"
                  : "text-neutral-400 dark:text-neutral-500"
              }`}
            >
              <motion.span
                aria-hidden
                initial={false}
                animate={{
                  opacity:
                    isGenerating || canSubmit || submitting ? 1 : 0,
                }}
                transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
                style={{
                  backgroundImage:
                    "linear-gradient(180deg, #3a9efc 0%, #178dfb 50%, #0c82f2 100%)",
                }}
                className="pointer-events-none absolute inset-0 rounded-full"
              />
              <span className="relative flex">
              <AnimatePresence mode="wait" initial={false}>
                {submitting ? (
                  <motion.span
                    key="submitting"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 22 }}
                    className="flex"
                  >
                    <Spinner size={16} className="text-blue-500" />
                  </motion.span>
                ) : isGenerating ? (
                  <motion.span
                    key="stop"
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.4, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 420, damping: 24 }}
                    className="block h-3 w-3 rounded-[3px] bg-current"
                  />
                ) : (
                  <motion.span
                    key="send"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 22 }}
                    className="flex"
                  >
                    <IconChevronRight size={16} stroke={2.5} />
                  </motion.span>
                )}
              </AnimatePresence>
              </span>
            </motion.button>
          </div>
          <FreeMessagesPill above={!isHome} lift={!isHome && scrollButtonVisible} />
          <ServerOverloadNotice
            above={!isHome}
            lift={!isHome && scrollButtonVisible}
          />
        </label>
      </form>
      )}
      {commandMenu.commandMenu}
      {!minMd && (
        <MobileComposerSheet
          open={mobileSheetOpen}
          onClose={() => setMobileSheetOpen(false)}
          model={model}
          setModel={setModel}
          onModelChange={onModelChange}
          thinking={thinking}
          setThinking={setThinking}
          search={search}
          setSearch={setSearch}
          flags={flags}
          isAuto={isAuto}
          isImage={isImage}
          canUseThinking={canUseThinking}
          canUseSearch={canUseSearch}
          openUpgrade={openUpgrade}
          openFilePicker={openFilePicker}
          attachDisabled={!canAttachFiles}
          integrations={mentionables}
          onMentionIntegration={(mention) =>
            insertMention(mention, "integration", "mobile_sheet")
          }
          skills={skillMentionables}
          onMentionSkill={(mention) =>
            insertMention(mention, "skill", "mobile_sheet")
          }
          canCompact={showCompact}
          compactLocked={compactLocked}
          onCompact={() => {
            setMobileSheetOpen(false);
            if (compactLocked) {
              openUpgrade("compact");
              return;
            }
            onCompact?.();
          }}
          isCompacting={isCompacting}
        />
      )}
      <PasteChoiceModal
        open={pastePrompt !== null}
        charCount={pastePrompt?.text.length ?? 0}
        onChoose={resolvePaste}
        onClose={() => setPastePrompt(null)}
      />
    </div>
  );
}
