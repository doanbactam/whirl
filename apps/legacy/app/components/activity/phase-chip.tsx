import { motion, useReducedMotion } from "motion/react";

import {
  ACTIVITIES,
  phaseActivityKind,
} from "~/components/activity/activity-kinds";
import {
  LabelMorph,
  useRotatingVerb,
} from "~/components/activity/rotating-verb";
import { IntegrationIcon } from "~/components/integrations/integration-logo";
import { useIntegrationActivity } from "~/components/integrations/use-integration-activity";
import { useSkillActivity } from "~/components/skills/use-skill-activity";
import { calcChipSummary } from "~/components/math/math-format";
import type { Phase } from "~/data/messages";

/**
 * The phases that render as a one-line chip. Documents and HTML artifacts get
 * full cards instead; weather and integration suggestions are chips only while
 * pending (the finalized widget/card takes over from there); an image is a
 * card through its whole pending → painted arc (see ImagePhaseCard) and only
 * chips when the paint failed or on legacy rows whose picture lives in the
 * prose as markdown.
 */
export type ChipPhase = Extract<
  Phase,
  {
    kind:
      | "thought"
      | "search"
      | "fetch"
      | "calc"
      | "mcp"
      | "skill"
      | "history"
      | "integrationSuggestion"
      | "weather"
      | "image";
  }
>;

export function isChipPhase(phase: Phase): phase is ChipPhase {
  if (phase.kind === "image") {
    return !phase.pending && (phase.images?.length ?? 0) === 0;
  }
  return (
    phase.kind === "thought" ||
    phase.kind === "search" ||
    phase.kind === "fetch" ||
    phase.kind === "calc" ||
    phase.kind === "mcp" ||
    phase.kind === "skill" ||
    phase.kind === "history" ||
    phase.kind === "integrationSuggestion" ||
    phase.kind === "weather"
  );
}

export function formatDurationSec(ms: number) {
  const sec = Math.max(1, Math.round(ms / 1000));
  return `${sec} second${sec === 1 ? "" : "s"}`;
}

// When several chips are pending at once (parallel tool calls), only the last
// one rotates whimsical verbs; the rest hold a plain gerund so the message
// never has two competing "live" rows. PhaseGroup borrows these for a chained
// call that isn't the live slot either.
export const PENDING_GERUNDS: Record<ChipPhase["kind"], string> = {
  thought: "Thinking",
  search: "Searching",
  fetch: "Reading the page",
  calc: "Calculating",
  mcp: "Using a tool",
  skill: "Learning a skill",
  history: "Searching your chats",
  integrationSuggestion: "Browsing integrations",
  weather: "Checking the weather",
  image: "Painting an image",
};

function finalLabel(phase: ChipPhase): string {
  switch (phase.kind) {
    case "thought":
      return `Thought for ${formatDurationSec(phase.durationMs)}`;
    case "search":
      return `Searched ${phase.sources} source${phase.sources === 1 ? "" : "s"}`;
    case "fetch":
      return `Read ${phase.sources} page${phase.sources === 1 ? "" : "s"}`;
    case "calc":
      return phase.error
        ? "Couldn't calculate"
        : `Calculated ${calcChipSummary(phase)}`;
    case "mcp":
      return phase.ok === false
        ? `Couldn't reach ${phase.server ?? "a tool"}`
        : phase.tool === "mcp_list_tools"
          ? phase.server
            ? `Checked ${phase.server}`
            : "Checked a connected app"
          : phase.server && phase.tool
            ? `Used ${phase.server} · ${phase.tool}`
            : phase.server
              ? `Used ${phase.server}`
              : "Used a tool";
    case "skill":
      return phase.ok === false
        ? `Couldn't load ${phase.name ?? "that skill"}`
        : phase.name
          ? `Learned ${phase.name}`
          : "Learned a skill";
    case "history":
      return phase.matches
        ? `Found ${phase.matches} past message${phase.matches === 1 ? "" : "s"}`
        : "Searched your chats";
    case "image":
      return phase.ok === false
        ? "Couldn't paint that"
        : (phase.count ?? 1) > 1
          ? `Painted ${phase.count} images`
          : "Painted an image";
    case "weather":
    case "integrationSuggestion":
      // Finalized weather renders as the full widget and a finalized
      // suggestion as the install card, never as chips — these branches only
      // exist to satisfy the exhaustive union.
      return "";
  }
}

/**
 * One tool step of a reply, from in-flight to done, in a single mounted
 * element. While pending it breathes: wobbling icon + shimmering rotating verb
 * ("Sniffing around…"). When the phase finalizes in place, the same slot
 * morphs — the icon settles and the verb swaps to the factual label
 * ("Searched 5 sources") with the exact animation the rotation already uses,
 * so in-progress flows into completed instead of cutting. If the server drops
 * an abandoned pending phase, the chip animates out (see the exit props).
 */
export function PhaseChip({
  phase,
  live,
  animate,
  entrance = true,
  topMargin,
  onClick,
}: {
  phase: ChipPhase;
  /** This is the message's one verb-rotating chip (the last pending one). */
  live: boolean;
  /** Whether the message is animating live (false on cached mounts). */
  animate: boolean;
  /** False when the chip takes over from the bottom live row — no re-entrance. */
  entrance?: boolean;
  topMargin?: boolean;
  onClick?: () => void;
}) {
  const pending = Boolean(phase.pending);
  const reduceMotion = useReducedMotion();
  const def = ACTIVITIES[phaseActivityKind(phase)];
  const Glyph = def.icon;
  const verb = useRotatingVerb(def.verbs, pending && live);
  const breathing = pending && !reduceMotion;

  // Store-installed integrations bring their own presentation: the dev's
  // monochrome mark replaces the generic plug, the chip shows their action
  // phrase ("Searching your issues") while the tool runs, and their completed
  // phrase ("Searched your issues") once it lands. Hand-added servers — and
  // listings without a mark or phrases — keep the plug + defaults.
  const isMcp = phase.kind === "mcp";
  const integration = useIntegrationActivity(
    isMcp ? phase.server : undefined,
    isMcp ? phase.tool : undefined,
  );
  // Skills get the same treatment: an installed skill's monochrome mark
  // replaces the school icon on its chip. Called unconditionally (hooks
  // rules), resolves to nothing for every other phase kind.
  const isSkill = phase.kind === "skill";
  const skill = useSkillActivity(isSkill ? phase.name : undefined);
  const brandedIconSvg =
    integration.branding?.iconSvg ?? skill.branding?.iconSvg;
  const succeeded = isMcp && phase.ok !== false;

  const text = pending
    ? (integration.action ??
      (live ? verb : PENDING_GERUNDS[phase.kind]))
    : ((succeeded ? integration.completed : null) ?? finalLabel(phase));

  // Until the installed list loads we can't tell a branded chip from a plain
  // one — render nothing for that beat (a cold cache resolves alongside the
  // thread itself) rather than the default look that then snaps to branding.
  if (integration.loading || skill.loading) return null;

  return (
    // No `layout` here: the chat feed scrolls in a container framer can't
    // track, so layout measurement during a scroll jump makes chips spring to
    // phantom positions (see the note on MessageBubble's root).
    <motion.div
      initial={
        animate && entrance ? { opacity: 0, y: -4, filter: "blur(4px)" } : false
      }
      animate={animate ? { opacity: 1, y: 0, filter: "blur(0px)" } : undefined}
      exit={{
        opacity: 0,
        y: -4,
        filter: "blur(4px)",
        transition: { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] },
      }}
      transition={{
        opacity: { duration: 0.24, ease: [0.22, 0.61, 0.36, 1] },
        filter: { duration: 0.26, ease: [0.22, 0.61, 0.36, 1] },
        default: { type: "spring", stiffness: 420, damping: 28 },
      }}
      className={`flex ${topMargin ? "mt-1" : ""}`}
    >
      {/* Always the same element in both states — swapping div ↔ button would
          remount the label slot and hard-cut the pending → complete morph. */}
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        title={
          // The completed phrase takes the label, so the precise identity
          // ("Context7 · resolve-library-id") moves into the hover title.
          // Failed paints tuck the provider's actual error here — the chip
          // stays quiet, but the reason is one hover away.
          !pending && isMcp && phase.server && phase.tool
            ? `${phase.server} · ${phase.tool}`
            : !pending && phase.kind === "image" && phase.ok === false
              ? phase.error
              : undefined
        }
        className={`-mx-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-left ${
          onClick
            ? "group/phase transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
            : "cursor-default"
        }`}
      >
        <motion.span
          aria-hidden
          animate={
            breathing
              ? { scale: [1, 1.12, 1], rotate: [0, 4, -4, 0] }
              : { scale: 1, rotate: 0 }
          }
          transition={
            breathing
              ? { duration: 2.6, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }
          }
          className="flex h-5 w-5 shrink-0 items-center justify-center text-neutral-500 dark:text-neutral-400"
        >
          {brandedIconSvg ? (
            <IntegrationIcon iconSvg={brandedIconSvg} size={16} />
          ) : (
            <Glyph size={16} stroke={2} />
          )}
        </motion.span>
        <LabelMorph
          text={text}
          ellipsis={pending}
          shimmer={pending}
          initial={pending}
          className={`text-[15px] leading-6 text-neutral-500 dark:text-neutral-400 ${
            onClick
              ? "underline decoration-transparent underline-offset-2 transition-colors group-hover/phase:text-neutral-700 group-hover/phase:decoration-neutral-400 dark:group-hover/phase:text-neutral-200 dark:group-hover/phase:decoration-neutral-500"
              : ""
          }`}
        />
      </button>
    </motion.div>
  );
}
