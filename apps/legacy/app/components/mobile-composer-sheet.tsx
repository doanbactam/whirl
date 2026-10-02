import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { TablerIcon } from "@tabler/icons-react";
import {
  IconBarbell,
  IconBolt,
  IconBrain,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCpu,
  IconFeather,
  IconFileZip,
  IconPaperclip,
  IconPhoto,
  IconPlugConnected,
  IconSchool,
  IconSearch,
  IconWand,
} from "@tabler/icons-react";

import type { GateFeature } from "~/components/upgrade-modal";
import type { IntegrationMention } from "~/components/composer-mentions";
import { IntegrationLogo } from "~/components/integrations/integration-logo";
import { PlanBadge } from "~/components/plan-badge";
import { modelLabel } from "~/data/models";

type ModelKey = "Auto" | "Fast" | "Basic" | "Max" | "Image";
type IconType = TablerIcon;

const PAGE_SLIDE_MS = 220;

// Keys are the persisted tier ids; labels come from MODEL_LABELS (the `Fast`
// key is the free-only Free model, `Basic` is the paid Fast tier). Keep the
// blurbs in sync with MODEL_TIERS in app/data/model-tiers.ts.
const MODELS: {
  key: ModelKey;
  blurb: string;
  icon: IconType;
}[] = [
  {
    key: "Auto",
    blurb: "Picks the best model for what you're asking",
    icon: IconWand,
  },
  {
    key: "Fast",
    blurb: "Light and quick, on the house",
    icon: IconFeather,
  },
  {
    key: "Basic",
    blurb: "Snappy answers for everyday questions",
    icon: IconBolt,
  },
  {
    key: "Max",
    blurb: "Our smartest model, uses the most usage",
    icon: IconBarbell,
  },
  {
    key: "Image",
    blurb: "Paints pictures instead of paragraphs",
    icon: IconPhoto,
  },
];

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

function badgeForGate(gate: GateFeature | null | undefined): string | null {
  if (!gate) return null;
  const plan = PLAN_BADGE_FOR_GATE[gate];
  return plan ? `/plan-badges/${plan}.svg` : null;
}

function SheetRow({
  icon,
  title,
  description,
  onClick,
  trailing,
  disabled,
}: {
  icon: IconType;
  title: string;
  description: string;
  onClick?: () => void;
  trailing?: React.ReactNode;
  disabled?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  const Glyph = icon;
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-2xl px-1 py-3 text-left transition ${
        onClick && !disabled
          ? "active:bg-black/[0.04] dark:active:bg-white/[0.06]"
          : ""
      } ${disabled ? "opacity-50" : ""}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/[0.05] text-neutral-600 dark:bg-white/[0.08] dark:text-neutral-200">
        <Glyph size={20} stroke={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-neutral-900 dark:text-neutral-100">
          {title}
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-neutral-500">
          {description}
        </span>
      </span>
      {trailing}
    </Tag>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`relative inline-flex h-[26px] w-[44px] shrink-0 overflow-hidden rounded-full p-0 transition-opacity ${
        disabled ? "opacity-60" : ""
      }`}
    >
      <span
        aria-hidden
        className={`block h-full w-full rounded-full transition-colors duration-200 ${
          checked ? "bg-[#0c82f2]" : "bg-neutral-300 dark:bg-neutral-600"
        }`}
      >
        <motion.span
          className="absolute top-[3px] left-[3px] h-5 w-5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
          animate={{ x: checked ? 18 : 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      </span>
    </button>
  );
}

export function MobileComposerSheet({
  open,
  onClose,
  model,
  setModel,
  onModelChange,
  thinking,
  setThinking,
  search,
  setSearch,
  flags,
  isAuto,
  isImage = false,
  canUseThinking,
  canUseSearch,
  openUpgrade,
  openFilePicker,
  attachDisabled,
  integrations = [],
  onMentionIntegration,
  skills = [],
  onMentionSkill,
  canCompact,
  compactLocked = false,
  onCompact,
  isCompacting,
}: {
  open: boolean;
  onClose: () => void;
  model: ModelKey;
  setModel: (m: ModelKey) => void;
  onModelChange?: (m: ModelKey) => void;
  thinking: boolean;
  setThinking: (v: boolean) => void;
  search: boolean;
  setSearch: (v: boolean) => void;
  flags: Record<GateFeature, boolean>;
  isAuto: boolean;
  isImage?: boolean;
  canUseThinking: boolean;
  canUseSearch: boolean;
  openUpgrade: (gate: GateFeature) => void;
  openFilePicker: () => void;
  attachDisabled: boolean;
  integrations?: IntegrationMention[];
  onMentionIntegration?: (mention: IntegrationMention) => void;
  skills?: IntegrationMention[];
  onMentionSkill?: (mention: IntegrationMention) => void;
  canCompact: boolean;
  compactLocked?: boolean;
  onCompact?: () => void;
  isCompacting: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const [path, setPath] = useState<
    "root" | "model" | "integrations" | "skills"
  >("root");
  const [slideHeight, setSlideHeight] = useState<number | undefined>();
  const rootRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const integrationsRef = useRef<HTMLDivElement>(null);
  const skillsRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) setPath("root");
  }, [open]);

  const page =
    path === "model"
      ? "2"
      : path === "integrations"
        ? "3"
        : path === "skills"
          ? "4"
          : "1";

  const updateSlideHeight = () => {
    const el =
      path === "model"
        ? modelRef.current
        : path === "integrations"
          ? integrationsRef.current
          : path === "skills"
            ? skillsRef.current
            : rootRef.current;
    if (el) setSlideHeight(el.offsetHeight);
  };

  useLayoutEffect(() => {
    updateSlideHeight();
  }, [
    path,
    open,
    canCompact,
    isAuto,
    thinking,
    search,
    integrations.length,
    skills.length,
  ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (path !== "root") setPath("root");
        else onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, path]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="composer-sheet-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/50 backdrop-blur-sm md:hidden"
          onClick={onClose}
        >
          <motion.div
            key="composer-sheet-panel"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[min(85dvh,640px)] overflow-hidden rounded-t-[20px] border-t border-black/[0.06] bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_40px_rgba(0,0,0,0.18)] dark:border-white/[0.08] dark:bg-[#18181a] dark:shadow-[0_-8px_40px_rgba(0,0,0,0.45)]"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" />
            {path !== "root" && (
              <button
                type="button"
                onClick={() => setPath("root")}
                className="mb-2 flex items-center gap-1 text-[13px] font-medium text-neutral-600 dark:text-neutral-400"
              >
                <IconChevronLeft size={16} stroke={2} />
                Back
              </button>
            )}
            <div
              className="t-page-slide overflow-hidden"
              data-page={page}
              style={slideHeight != null ? { minHeight: slideHeight } : undefined}
            >
              <section
                className="t-page"
                data-page-id="1"
                aria-hidden={page !== "1"}
              >
                <div ref={rootRef} className="flex flex-col">
                  <SheetRow
                    icon={IconPaperclip}
                    title="Attach"
                    description="Add photos, files, and more"
                    disabled={attachDisabled}
                    onClick={() => {
                      if (attachDisabled) return;
                      onClose();
                      openFilePicker();
                    }}
                  />
                  {integrations.length > 0 && (
                    <SheetRow
                      icon={IconPlugConnected}
                      title="Integrations"
                      description="Mention one to bring its tools along"
                      onClick={() => setPath("integrations")}
                      trailing={
                        <IconChevronRight
                          size={18}
                          stroke={2}
                          className="shrink-0 text-neutral-500"
                        />
                      }
                    />
                  )}
                  {skills.length > 0 && (
                    <SheetRow
                      icon={IconSchool}
                      title="Skills"
                      description="Mention one so Whirl learns it right away"
                      onClick={() => setPath("skills")}
                      trailing={
                        <IconChevronRight
                          size={18}
                          stroke={2}
                          className="shrink-0 text-neutral-500"
                        />
                      }
                    />
                  )}
                  <SheetRow
                    icon={IconCpu}
                    title="Model"
                    description={`Currently ${modelLabel(model)}`}
                    onClick={() => setPath("model")}
                    trailing={
                      <IconChevronRight
                        size={18}
                        stroke={2}
                        className="shrink-0 text-neutral-500"
                      />
                    }
                  />
                  <SheetRow
                    icon={IconBrain}
                    title="Thinking"
                    description={
                      isAuto
                        ? "Auto picks when to think things through"
                        : isImage
                          ? "Not a thing for images"
                          : "Works through tricky problems more carefully"
                    }
                    trailing={
                      isAuto || isImage ? (
                        <span className="text-[12px] font-medium text-neutral-500">
                          {isAuto ? "Auto" : "Off"}
                        </span>
                      ) : !flags.reasoning ? (
                        <img
                          src="/plan-badges/turbo.svg"
                          alt=""
                          className="h-4 w-auto shrink-0 opacity-60 dark:invert"
                        />
                      ) : (
                        <Toggle
                          checked={thinking}
                          disabled={!canUseThinking}
                          onChange={() => {
                            if (!flags.reasoning) {
                              openUpgrade("reasoning");
                              return;
                            }
                            setThinking(!thinking);
                          }}
                        />
                      )
                    }
                  />
                  <SheetRow
                    icon={IconSearch}
                    title="Web search"
                    description={
                      isAuto
                        ? "Auto looks things up when it helps"
                        : isImage
                          ? "Not a thing for images"
                          : "Pull in fresh info from the web"
                    }
                    trailing={
                      isAuto || isImage ? (
                        <span className="text-[12px] font-medium text-neutral-500">
                          {isAuto ? "Auto" : "Off"}
                        </span>
                      ) : !flags.can_search ? (
                        <img
                          src="/plan-badges/mini.svg"
                          alt=""
                          className="h-4 w-auto shrink-0 opacity-60 dark:invert"
                        />
                      ) : (
                        <Toggle
                          checked={search}
                          disabled={!canUseSearch}
                          onChange={() => {
                            if (!flags.can_search) {
                              openUpgrade("can_search");
                              return;
                            }
                            setSearch(!search);
                          }}
                        />
                      )
                    }
                  />
                  {canCompact && (
                    <SheetRow
                      icon={IconFileZip}
                      title="Compact thread"
                      description={
                        compactLocked
                          ? "Compaction is on paid plans"
                          : "Summarize the conversation to free up room"
                      }
                      disabled={isCompacting}
                      trailing={
                        compactLocked ? (
                          <PlanBadge plan="mini" />
                        ) : undefined
                      }
                      onClick={() => {
                        onClose();
                        onCompact?.();
                      }}
                    />
                  )}
                </div>
              </section>
              <section
                className="t-page"
                data-page-id="2"
                aria-hidden={page !== "2"}
              >
                <div ref={modelRef} className="flex flex-col gap-0.5">
                  {MODELS.filter(
                    (m) => !(flags.auto && m.key === "Fast"),
                  ).map((m) => {
                    const selected = model === m.key;
                    const gate = MODEL_GATE[m.key];
                    const locked = gate !== null && !flags[gate];
                    const Glyph = m.icon;
                    return (
                      <div key={m.key} className="flex flex-col gap-0.5">
                      {/* Image sits apart from the text tiers — same split as
                          the desktop model menu. */}
                      {m.key === "Image" && (
                        <div className="mx-1 my-1 h-px bg-black/[0.06] dark:bg-white/[0.08]" />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (locked && gate) {
                            openUpgrade(gate);
                            return;
                          }
                          setModel(m.key);
                          onModelChange?.(m.key);
                          onClose();
                        }}
                        className="flex w-full items-center gap-3 rounded-2xl px-1 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/[0.05] text-neutral-600 dark:bg-white/[0.08] dark:text-neutral-200">
                          <Glyph size={20} stroke={2} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="text-[15px] font-medium text-neutral-900 dark:text-neutral-100">
                              {modelLabel(m.key)}
                            </span>
                            {locked && badgeForGate(gate) && (
                              <img
                                src={badgeForGate(gate)!}
                                alt=""
                                className="h-3.5 w-auto opacity-60 dark:invert"
                              />
                            )}
                          </span>
                          <span className="mt-0.5 block text-[13px] leading-snug text-neutral-500">
                            {m.blurb}
                          </span>
                        </span>
                        {selected && !locked && (
                          <IconCheck
                            size={18}
                            stroke={2.5}
                            className="shrink-0 text-[#0c82f2]"
                          />
                        )}
                      </button>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section
                className="t-page"
                data-page-id="3"
                aria-hidden={page !== "3"}
              >
                <div ref={integrationsRef} className="flex flex-col gap-0.5">
                  {integrations.map((integration) => (
                    <button
                      key={integration.serverId}
                      type="button"
                      onClick={() => {
                        onMentionIntegration?.(integration);
                        onClose();
                      }}
                      className="flex w-full items-center gap-3 rounded-2xl px-1 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                    >
                      <IntegrationLogo
                        name={integration.name}
                        logoUrl={integration.logoUrl}
                        iconSvg={integration.iconSvg}
                        size={40}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium text-neutral-900 dark:text-neutral-100">
                          {integration.name}
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-neutral-500">
                          Mention to use its tools in this message
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <section
                className="t-page"
                data-page-id="4"
                aria-hidden={page !== "4"}
              >
                <div ref={skillsRef} className="flex flex-col gap-0.5">
                  {skills.map((skill) => (
                    <button
                      key={skill.serverId}
                      type="button"
                      onClick={() => {
                        onMentionSkill?.(skill);
                        onClose();
                      }}
                      className="flex w-full items-center gap-3 rounded-2xl px-1 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                    >
                      <IntegrationLogo
                        name={skill.name}
                        logoUrl={skill.logoUrl}
                        iconSvg={skill.iconSvg}
                        size={40}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium text-neutral-900 dark:text-neutral-100">
                          {skill.name}
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-neutral-500">
                          Mention to apply it to this message
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
