import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import type { TablerIcon } from "@tabler/icons-react";
import {
  IconBarbell,
  IconBolt,
  IconBrain,
  IconCheck,
  IconFeather,
  IconFileZip,
  IconPhoto,
  IconPlugConnected,
  IconSchool,
  IconSearch,
  IconWand,
} from "@tabler/icons-react";

import type { GateFeature } from "~/components/upgrade-modal";
import type { IntegrationMention } from "~/components/composer-mentions";
import { IntegrationLogo } from "~/components/integrations/integration-logo";
import {
  DropdownShell,
  dropdownDividerClass,
  dropdownItemClass,
} from "~/components/dropdown-menu";
import { MutedPlanBadge, PlanBadge } from "~/components/plan-badge";
import { modelLabel } from "~/data/models";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

export type ModelKey = "Auto" | "Fast" | "Basic" | "Max" | "Image";

/** An attached image the user can tag inline, Slack-mention style. */
export type ImageTagOption = { name: string; previewUrl?: string };

type Flags = Record<GateFeature, boolean>;
type IconType = TablerIcon;

type CommandTrigger = { start: number; char: "/" | "@"; query: string };

type Command = {
  id: string;
  label: string;
  icon: IconType;
  /** Integration branding, rendered in place of `icon` when present. */
  logo?: Pick<IntegrationMention, "name" | "logoUrl" | "iconSvg">;
  /**
   * Text that replaces the "/query" or "@query" trigger on select (mentions
   * insert "@Name "). Commands without it just have the trigger removed.
   */
  insertText?: string;
  keywords?: string[];
  hint?: string;
  selected?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  badgePlan?: "mini" | "turbo" | "mega";
  badgeFullColor?: boolean;
  onSelect: () => void;
};

// Keys are the persisted tier ids; labels come from MODEL_LABELS (the `Fast`
// key is the free-only Free model; `Basic` is the paid Fast tier).
const MODELS: { key: ModelKey; icon: IconType }[] = [
  { key: "Auto", icon: IconWand },
  { key: "Fast", icon: IconFeather },
  { key: "Basic", icon: IconBolt },
  { key: "Max", icon: IconBarbell },
  { key: "Image", icon: IconPhoto },
];

const MODEL_GATE: Record<ModelKey, GateFeature | null> = {
  Auto: "auto",
  Fast: null,
  Basic: "basic",
  Max: "max",
  Image: "image",
};

const PLAN_BADGE_FOR_GATE: Partial<
  Record<GateFeature, "mini" | "turbo" | "mega">
> = {
  auto: "mini",
  can_search: "mini",
  basic: "mini",
  compact: "mini",
  reasoning: "mini",
  max: "turbo",
  image: "turbo",
};

// Extra search terms per model so e.g. "/image" or "/draw" lands on the right
// tier; every model already matches "model" and "switch".
const MODEL_KEYWORDS: Partial<Record<ModelKey, string[]>> = {
  Image: ["image", "picture", "generate", "draw", "art"],
};

export function detectCommandTrigger(
  value: string,
  caret: number,
): CommandTrigger | null {
  if (caret < 1) return null;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === "/" || ch === "@") {
      const prev = value[i - 1];
      if (i !== 0 && !/\s/.test(prev ?? "")) return null;
      const query = value.slice(i + 1, caret);
      if (/\s/.test(query)) return null;
      return { start: i, char: ch, query };
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

function filterCommands(cmds: Command[], query: string): Command[] {
  if (!query) return cmds;
  const q = query.toLowerCase();
  const scored: { cmd: Command; score: number }[] = [];
  for (const c of cmds) {
    const haystacks = [c.label, ...(c.keywords ?? [])].map((h) =>
      h.toLowerCase(),
    );
    let best = -1;
    for (const h of haystacks) {
      if (h.startsWith(q)) best = Math.max(best, 100);
      else if (h.includes(q)) best = Math.max(best, 50);
    }
    if (best > -1) scored.push({ cmd: c, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.cmd);
}

type Context = {
  model: ModelKey;
  thinking: boolean;
  search: boolean;
  flags: Flags;
  isAuto: boolean;
  isImage: boolean;
  setModel: (m: ModelKey) => void;
  onModelChange?: (m: ModelKey) => void;
  setThinking: (v: boolean) => void;
  setSearch: (v: boolean) => void;
  openUpgrade: (gate: GateFeature) => void;
  canCompact: boolean;
  compactLocked?: boolean;
  compactThread?: () => void;
  integrations: IntegrationMention[];
  mentionIntegration?: (mention: IntegrationMention) => void;
  skills: IntegrationMention[];
  mentionSkill?: (mention: IntegrationMention) => void;
  imageTags: ImageTagOption[];
  mentionImageTag?: (tag: string) => void;
};

type CommandGroup = { id: string; label: string; commands: Command[] };

/**
 * Every composer command, in flat labeled groups — pick a model directly,
 * toggle thinking or web search in place, or compact the thread. Nothing is
 * nested: each item commits immediately; the groups are just tiny headers so
 * it's clear what each thing is.
 */
function buildGroups(ctx: Context): CommandGroup[] {
  // Models — listed directly; the current one is ticked. The Free model
  // (`Fast` key) is the free tier's, so paid plans don't get it offered.
  const models: Command[] = MODELS.filter(
    (m) => !(ctx.flags.auto && m.key === "Fast"),
  ).map((m) => {
    const gate = MODEL_GATE[m.key];
    const locked = gate !== null && !ctx.flags[gate];
    return {
      id: `model:${m.key}`,
      label: modelLabel(m.key),
      icon: m.icon,
      keywords: [
        "model",
        "switch",
        ...(MODEL_KEYWORDS[m.key] ?? []),
        ...(locked ? ["locked", "upgrade"] : []),
      ],
      selected: ctx.model === m.key,
      badgePlan: locked ? PLAN_BADGE_FOR_GATE[gate!] : undefined,
      onSelect: () => {
        if (locked && gate) {
          ctx.openUpgrade(gate);
          return;
        }
        ctx.setModel(m.key);
        ctx.onModelChange?.(m.key);
      },
    };
  });

  // Thinking + web search — direct toggles. Auto decides for you, so they're
  // shown but inert when the model is Auto.
  const thinkingLocked = !ctx.flags.reasoning;
  const searchLocked = !ctx.flags.can_search;
  const settings: Command[] = [
    {
      id: "thinking",
      label: "Thinking",
      icon: IconBrain,
      keywords: ["reasoning", "reason", "think", "toggle", "enable", "disable"],
      hint: ctx.isAuto ? "Auto" : ctx.isImage || !ctx.thinking ? "Off" : "On",
      disabled: ctx.isAuto || ctx.isImage,
      disabledHint: ctx.isImage
        ? "Not a thing for images"
        : "Auto handles this for you",
      badgePlan:
        thinkingLocked && !ctx.thinking && !ctx.isImage
          ? PLAN_BADGE_FOR_GATE.reasoning
          : undefined,
      onSelect: () => {
        if (ctx.isAuto || ctx.isImage) return;
        const next = !ctx.thinking;
        if (next && thinkingLocked) {
          ctx.openUpgrade("reasoning");
          return;
        }
        ctx.setThinking(next);
      },
    },
    {
      id: "search",
      label: "Web search",
      icon: IconSearch,
      keywords: ["web", "browse", "lookup", "internet", "toggle", "enable", "disable"],
      hint: ctx.isAuto ? "Auto" : ctx.isImage || !ctx.search ? "Off" : "On",
      disabled: ctx.isAuto || ctx.isImage,
      disabledHint: ctx.isImage
        ? "Not a thing for images"
        : "Auto handles this for you",
      badgePlan:
        searchLocked && !ctx.search && !ctx.isImage
          ? PLAN_BADGE_FOR_GATE.can_search
          : undefined,
      onSelect: () => {
        if (ctx.isAuto || ctx.isImage) return;
        const next = !ctx.search;
        if (next && searchLocked) {
          ctx.openUpgrade("can_search");
          return;
        }
        ctx.setSearch(next);
      },
    },
  ];

  const groups: CommandGroup[] = [
    { id: "model", label: "Model", commands: models },
    { id: "settings", label: "Settings", commands: settings },
  ];

  if (ctx.canCompact) {
    groups.push({
      id: "thread",
      label: "Thread",
      commands: [
        {
          id: "compact",
          label: "Compact thread",
          icon: IconFileZip,
          keywords: ["summarize", "summary", "compact", "shrink", "compress"],
          badgePlan: ctx.compactLocked ? PLAN_BADGE_FOR_GATE.compact : undefined,
          badgeFullColor: ctx.compactLocked,
          onSelect: () => {
            if (ctx.compactLocked) {
              ctx.openUpgrade("compact");
              return;
            }
            ctx.compactThread?.();
          },
        },
      ],
    });
  }

  // Installed integrations, mentionable by name. Selecting one writes "@Name"
  // into the message itself (Slack-style) rather than toggling anything — and
  // the "@" trigger floats this group to the top so it reads like a mention
  // picker.
  if (ctx.integrations.length > 0 && ctx.mentionIntegration) {
    groups.push({
      id: "integrations",
      label: "Integrations",
      commands: ctx.integrations.map((integration) => ({
        id: `integration:${integration.serverId}`,
        label: integration.name,
        icon: IconPlugConnected,
        logo: integration,
        insertText: `@${integration.name} `,
        keywords: ["integration", "mention", "tools", "connect"],
        onSelect: () => ctx.mentionIntegration?.(integration),
      })),
    });
  }

  // Installed skills, mentionable exactly like integrations — selecting one
  // writes "@Name" into the message and the backend preloads its instructions.
  if (ctx.skills.length > 0 && ctx.mentionSkill) {
    groups.push({
      id: "skills",
      label: "Skills",
      commands: ctx.skills.map((skill) => ({
        id: `skill:${skill.serverId}`,
        label: skill.name,
        icon: IconSchool,
        logo: skill,
        insertText: `@${skill.name} `,
        keywords: ["skill", "mention", "instructions", "learn"],
        onSelect: () => ctx.mentionSkill?.(skill),
      })),
    });
  }

  // Attached images, taggable inline by their file name — with the picture
  // itself as the row's face, so it's clear which one is which ("put
  // @sunset.jpg on top of @logo.png").
  if (ctx.imageTags.length > 0) {
    groups.push({
      id: "images",
      label: "Your images",
      commands: ctx.imageTags.map((image, index) => ({
        id: `image-tag:${index}-${image.name}`,
        label: `@${image.name}`,
        icon: IconPhoto,
        ...(image.previewUrl
          ? { logo: { name: image.name, logoUrl: image.previewUrl } }
          : {}),
        insertText: `@${image.name} `,
        keywords: ["image", "tag", "img", "picture", "photo"],
        onSelect: () => ctx.mentionImageTag?.(image.name),
      })),
    });
  }

  return groups;
}

export type ComposerCommandMenuController = {
  commandMenu: ReactNode;
  isOpen: boolean;
  onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean;
  refresh: () => void;
  close: () => void;
};

export function useComposerCommandMenu(props: {
  value: string;
  setValue: (v: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  model: ModelKey;
  thinking: boolean;
  search: boolean;
  flags: Flags;
  isAuto: boolean;
  isImage?: boolean;
  setModel: (m: ModelKey) => void;
  onModelChange?: (m: ModelKey) => void;
  setThinking: (v: boolean) => void;
  setSearch: (v: boolean) => void;
  openUpgrade: (gate: GateFeature) => void;
  canCompact?: boolean;
  compactLocked?: boolean;
  onCompact?: () => void;
  compactionActive?: boolean;
  integrations?: IntegrationMention[];
  onMentionIntegration?: (mention: IntegrationMention) => void;
  skills?: IntegrationMention[];
  onMentionSkill?: (mention: IntegrationMention) => void;
  imageTags?: ImageTagOption[];
  onMentionImageTag?: (tag: string) => void;
}): ComposerCommandMenuController {
  const {
    value,
    setValue,
    textareaRef,
    model,
    thinking,
    search,
    flags,
    isAuto,
    isImage = false,
    setModel,
    onModelChange,
    setThinking,
    setSearch,
    openUpgrade,
    canCompact = false,
    compactLocked = false,
    onCompact,
    compactionActive = false,
    integrations = [],
    onMentionIntegration,
    skills = [],
    onMentionSkill,
    imageTags = [],
    onMentionImageTag,
  } = props;

  const [trigger, setTrigger] = useState<CommandTrigger | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const capture = useCapture();

  const lastTriggerStart = useRef<number | null>(null);
  const pendingCaret = useRef<number | null>(null);

  const ctx: Context = {
    model,
    thinking,
    search,
    flags,
    isAuto,
    isImage,
    setModel,
    onModelChange,
    setThinking,
    setSearch,
    openUpgrade,
    canCompact: canCompact && !compactionActive,
    compactLocked,
    compactThread: onCompact,
    integrations,
    mentionIntegration: onMentionIntegration,
    skills,
    mentionSkill: onMentionSkill,
    imageTags,
    mentionImageTag: onMentionImageTag,
  };

  const query = trigger?.query ?? "";
  // Both triggers open the full palette; "@" just leads with the integrations
  // group, Slack-style, so a mention is one Enter away while every other
  // command stays reachable.
  const built = buildGroups(ctx);
  const mentionGroupIds = new Set(["integrations", "skills", "images"]);
  const ordered =
    trigger?.char === "@"
      ? [
          ...built.filter((g) => mentionGroupIds.has(g.id)),
          ...built.filter((g) => !mentionGroupIds.has(g.id)),
        ]
      : built;
  const groups = ordered
    .map((g) => ({ ...g, commands: filterCommands(g.commands, query) }))
    .filter((g) => g.commands.length > 0);
  // Flattened across groups for keyboard navigation — labels/dividers aren't
  // selectable, so arrow keys move through these in order.
  const flatCommands = groups.flatMap((g) => g.commands);

  // Reset active index when the list shape changes.
  const filteredKey = flatCommands.map((c) => c.id).join("|");
  useEffect(() => {
    setActiveIndex(0);
  }, [filteredKey]);

  // Restore caret after we mutate the input value imperatively.
  useEffect(() => {
    if (pendingCaret.current == null) return;
    const pos = pendingCaret.current;
    pendingCaret.current = null;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(pos, pos);
  }, [value, textareaRef]);

  const detect = (newValue: string, caret: number) => {
    const t = detectCommandTrigger(newValue, caret);
    if (!t) {
      lastTriggerStart.current = null;
      setTrigger(null);
      return;
    }
    if (lastTriggerStart.current !== t.start) {
      lastTriggerStart.current = t.start;
      setActiveIndex(0);
    }
    setTrigger(t);
  };

  const close = () => {
    lastTriggerStart.current = null;
    setTrigger(null);
  };

  // Swap the trigger text ("/query" or "@query") for the command's outcome:
  // nothing for toggles, the full "@Name " token for mentions.
  const replaceTriggerInInput = (replacement: string) => {
    if (!trigger) return;
    const before = value.slice(0, trigger.start);
    const after = value.slice(trigger.start + 1 + trigger.query.length);
    setValue(before + replacement + after);
    pendingCaret.current = trigger.start + replacement.length;
  };

  const select = (cmd: Command) => {
    if (cmd.disabled) return;
    cmd.onSelect();
    capture(ANALYTICS_EVENTS.commandMenuUsed, {
      category: cmd.id.split(":")[0],
      command: cmd.id,
    });
    replaceTriggerInInput(cmd.insertText ?? "");
    close();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!trigger) return false;
    if (e.nativeEvent.isComposing) return false;

    switch (e.key) {
      case "ArrowDown": {
        if (flatCommands.length === 0) return false;
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % flatCommands.length);
        return true;
      }
      case "ArrowUp": {
        if (flatCommands.length === 0) return false;
        e.preventDefault();
        setActiveIndex(
          (i) => (i - 1 + flatCommands.length) % flatCommands.length,
        );
        return true;
      }
      case "Enter":
      case "Tab": {
        if (flatCommands.length === 0) return false;
        const cmd = flatCommands[activeIndex];
        if (!cmd || cmd.disabled) return false;
        e.preventDefault();
        select(cmd);
        return true;
      }
      case "Escape": {
        e.preventDefault();
        close();
        return true;
      }
      default:
        return false;
    }
  };

  const refresh = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    detect(ta.value, ta.selectionStart ?? ta.value.length);
  };

  const commandMenu = (
    <AnimatePresence>
      {trigger && (
        <motion.div
          key="command-menu"
          role="menu"
          aria-label="Composer commands"
          layout
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
          className="absolute bottom-full left-14 z-30 mb-2 w-72 max-w-[calc(100%-4rem)]"
        >
          <DropdownShell>
            {/* Hard height cap with internal scrolling. The menu anchors ABOVE
                the composer, which sits mid-screen on home — so a viewport-based
                limit alone lets a long list (models + settings + integrations +
                image tags) march right off the top of the screen. Cap it at a
                palette-sized box and let the list scroll inside; keyboard nav
                keeps the active row in view via scrollIntoView. */}
            <div className="flex max-h-[min(320px,40vh)] flex-col gap-1 overflow-y-auto overscroll-contain">
              {flatCommands.length === 0 ? (
                <div className="px-2.5 py-1.5 text-[13px] text-neutral-400 dark:text-neutral-500">
                  No matches
                </div>
              ) : (
                groups.map((group, gi) => (
                  <div key={group.id} className="flex flex-col gap-1">
                    {gi > 0 && <div className={dropdownDividerClass} />}
                    <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                      {group.label}
                    </div>
                    {group.commands.map((cmd) => {
                      const index = flatCommands.indexOf(cmd);
                      return (
                        <CommandItemView
                          key={cmd.id}
                          command={cmd}
                          active={index === activeIndex}
                          onSelect={() => select(cmd)}
                          onHover={() => setActiveIndex(index)}
                        />
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </DropdownShell>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return {
    commandMenu,
    isOpen: trigger !== null,
    onKeyDown,
    refresh,
    close,
  };
}

function CommandItemView({
  command,
  active,
  onSelect,
  onHover,
}: {
  command: Command;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const Glyph = command.icon;

  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      aria-disabled={command.disabled || undefined}
      title={command.disabled ? command.disabledHint : undefined}
      onMouseDown={(e) => {
        e.preventDefault();
        if (!command.disabled) onSelect();
      }}
      onMouseEnter={onHover}
      className={`${dropdownItemClass} font-medium ${
        command.disabled
          ? "cursor-not-allowed opacity-50"
          : active
            ? "bg-neutral-100 dark:bg-white/[0.06]"
            : ""
      }`}
    >
      {command.logo ? (
        <IntegrationLogo
          name={command.logo.name}
          logoUrl={command.logo.logoUrl}
          iconSvg={command.logo.iconSvg}
          size={18}
        />
      ) : (
        <Glyph
          size={16}
          stroke={2}
          className={`shrink-0 transition-colors duration-100 ${
            command.disabled
              ? ""
              : active
                ? "text-neutral-900 dark:text-neutral-100"
                : "text-neutral-400 dark:text-neutral-500"
          }`}
        />
      )}
      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
        {command.label}
        {command.selected && (
          <IconCheck
            size={13}
            stroke={2.5}
            className="shrink-0 text-neutral-400 dark:text-neutral-500"
          />
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-neutral-400 dark:text-neutral-500">
        {command.badgePlan ? (
          command.badgeFullColor ? (
            <PlanBadge plan={command.badgePlan} className="h-3.5 w-auto shrink-0" />
          ) : (
            <MutedPlanBadge plan={command.badgePlan} />
          )
        ) : command.hint ? (
          <span>{command.hint}</span>
        ) : null}
      </span>
    </button>
  );
}
