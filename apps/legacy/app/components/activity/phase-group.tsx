import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  IconChevronRight,
  IconSparkles,
  IconStack2,
} from "@tabler/icons-react";

import {
  ACTIVITIES,
  phaseActivityKind,
} from "~/components/activity/activity-kinds";
import {
  PENDING_GERUNDS,
  PhaseChip,
  type ChipPhase,
} from "~/components/activity/phase-chip";
import type { ChipEntry } from "~/components/activity/render-plan";
import {
  LabelMorph,
  useRotatingVerb,
} from "~/components/activity/rotating-verb";
import { IntegrationIcon } from "~/components/integrations/integration-logo";
import { useIntegrationActivity } from "~/components/integrations/use-integration-activity";
import { useSkillActivity } from "~/components/skills/use-skill-activity";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

// How long each narration holds the indicator before the next one may take
// over — one full shimmer pass (1s, see .shimmer-loop) plus its settle, so a
// label always finishes saying something before it morphs.
const NARRATION_HOLD_MS = 1200;
// A gap between calls must actually last this long before the "Working…"
// filler appears — the sub-second blip between back-to-back calls never
// flashes it.
const GAP_DELAY_MS = 1200;

type Narration = { key: string; phase: ChipPhase | null };

// Identity of what's being narrated — only flips of this key (never raw
// object identity, which churns every stream update) drive icon/label swaps.
function narrationKey(phase: ChipPhase | null): string {
  if (!phase) return "gap";
  if (phase.kind === "mcp") {
    return `mcp:${phase.server ?? ""}:${phase.tool ?? ""}`;
  }
  if (phase.kind === "skill") return `skill:${phase.name ?? ""}`;
  return phase.kind;
}

/**
 * Rate-limit what the live indicator narrates. When the model spams calls,
 * the raw "most recent pending phase" flips several times a second — icon
 * spinning, label morphing nonstop, the whole chip spasming. This holds each
 * narration on screen for at least one shimmer pass, collapses a burst of
 * flips into whatever the latest state is when the hold expires, and admits
 * the gap filler only once a gap has genuinely lasted a beat.
 */
function useSteadyNarration(target: Narration, active: boolean): Narration {
  const [shown, setShown] = useState(target);
  // Stamped at mount so the very first narration gets its full hold too.
  const shownAtRef = useRef(Date.now());
  const targetRef = useRef(target);
  targetRef.current = target;
  const isGap = target.phase === null;

  useEffect(() => {
    if (!active || targetRef.current.key === shown.key) return;
    const elapsed = Date.now() - shownAtRef.current;
    const wait = Math.max(NARRATION_HOLD_MS - elapsed, isGap ? GAP_DELAY_MS : 0);
    if (wait <= 0) {
      shownAtRef.current = Date.now();
      setShown(targetRef.current);
      return;
    }
    const id = window.setTimeout(() => {
      shownAtRef.current = Date.now();
      setShown(targetRef.current);
    }, wait);
    return () => window.clearTimeout(id);
  }, [target.key, isGap, active, shown.key]);

  return shown;
}

// Between calls in a chain — the last one landed, the next hasn't started —
// there's no activity to borrow verbs from, so the indicator hums these.
const WORKING_VERBS = [
  "Working",
  "Whirring",
  "On the case",
  "Making moves",
  "Chaining tools",
  "Juggling tasks",
  "Spinning plates",
  "Plotting next steps",
  "Lining things up",
  "Keeping busy",
];

/**
 * A chain of back-to-back tool calls, rendered as a single indicator instead
 * of one chip per call. While the chain runs it narrates only the most recent
 * call (branded action phrase or that activity's whimsical verbs), and hums
 * generic working verbs through the gaps between calls — steadied by
 * useSteadyNarration so call spam can't make it spasm. When the chain wraps
 * it settles into a collapsed "Did N things" row — click to unfold the
 * individual chips, each still fully clickable (sources, reasoning, calc).
 */
export function PhaseGroup({
  chips,
  open,
  live,
  animate,
  entrance = true,
  topMargin,
  chipClick,
}: {
  chips: ChipEntry[];
  /** The chain is still running — render the single live indicator. */
  open: boolean;
  /** This is the message's one verb-rotating slot (see MessageBubble). */
  live: boolean;
  /** Whether the message is animating live (false on cached mounts). */
  animate: boolean;
  /** False when the group takes over from the bottom live row — no re-entrance. */
  entrance?: boolean;
  topMargin?: boolean;
  /** Click handler factory for the unfolded chips (sources, reasoning, …). */
  chipClick: (phase: ChipPhase, index: number) => (() => void) | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const capture = useCapture();
  const reduceMotion = useReducedMotion();

  // The call the indicator narrates: the most recent pending chip, steadied
  // so a burst of rapid calls reads as a calm sequence instead of a spasm.
  // Between calls there is none — that's the "Working…" gap.
  const rawPending =
    [...chips].reverse().find((c) => c.phase.pending)?.phase ?? null;
  const narration = useSteadyNarration(
    { key: narrationKey(rawPending), phase: rawPending },
    open,
  );
  const pendingPhase = open ? (narration.phase ?? undefined) : undefined;
  const mcpPending = pendingPhase?.kind === "mcp" ? pendingPhase : undefined;
  const skillPending = pendingPhase?.kind === "skill" ? pendingPhase : undefined;
  const integration = useIntegrationActivity(
    mcpPending?.server,
    mcpPending?.tool,
  );
  const skill = useSkillActivity(skillPending?.name);
  // Unlike a standalone chip, the group never holds off for branding — its
  // label is a morphing slot anyway, so verbs flowing into "Searching your
  // issues" reads as intended rather than as a flash.
  const brandedIconSvg = open
    ? (integration.branding?.iconSvg ?? skill.branding?.iconSvg)
    : undefined;

  const activity = pendingPhase
    ? ACTIVITIES[phaseActivityKind(pendingPhase)]
    : null;
  const verb = useRotatingVerb(activity?.verbs ?? WORKING_VERBS, open && live);
  const breathing = open && !reduceMotion;

  const text = !open
    ? `Did ${chips.length} thing${chips.length === 1 ? "" : "s"}`
    : pendingPhase
      ? (integration.action ??
        (live ? verb : PENDING_GERUNDS[pendingPhase.kind]))
      : live
        ? verb
        : "Working";

  const Glyph = !open ? IconStack2 : activity ? activity.icon : IconSparkles;
  const iconKey = !open
    ? "done"
    : brandedIconSvg
      ? `branded-${mcpPending?.server ?? skillPending?.name ?? ""}`
      : activity
        ? phaseActivityKind(pendingPhase!)
        : "working";

  const toggleSteps = () => {
    if (!expanded) {
      capture(ANALYTICS_EVENTS.toolChainExpanded, {
        step_count: chips.length,
      });
    }
    setExpanded((v) => !v);
  };

  return (
    // Same motion recipe as PhaseChip so a chain enters/exits the feed
    // exactly like the chips it replaces (and no `layout` — see the note on
    // MessageBubble's root).
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
      className={`flex flex-col items-start ${topMargin ? "mt-1" : ""}`}
    >
      {/* One element through both states — swapping it out would remount the
          label slot and hard-cut the verbs → "Did N things" morph. */}
      <button
        type="button"
        onClick={open ? undefined : toggleSteps}
        disabled={open}
        aria-expanded={open ? undefined : expanded}
        className={`-mx-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-left ${
          open
            ? "cursor-default"
            : "group/phase transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
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
          className="relative flex h-5 w-5 shrink-0 items-center justify-center text-neutral-500 dark:text-neutral-400"
        >
          {/* The glyph follows the chain — each call's icon spins in as the
              model moves on, and the stack settles in when the chain wraps. */}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={iconKey}
              initial={{ opacity: 0, scale: 0.5, rotate: -40 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.5, rotate: 40 }}
              transition={{ type: "spring", stiffness: 460, damping: 30 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              {brandedIconSvg ? (
                <IntegrationIcon iconSvg={brandedIconSvg} size={16} />
              ) : (
                <Glyph size={16} stroke={2} />
              )}
            </motion.span>
          </AnimatePresence>
        </motion.span>
        <LabelMorph
          text={text}
          ellipsis={open}
          shimmer={open}
          initial={open}
          className={`text-[15px] leading-6 text-neutral-500 dark:text-neutral-400 ${
            open
              ? ""
              : "underline decoration-transparent underline-offset-2 transition-colors group-hover/phase:text-neutral-700 group-hover/phase:decoration-neutral-400 dark:group-hover/phase:text-neutral-200 dark:group-hover/phase:decoration-neutral-500"
          }`}
        />
        {!open && (
          <motion.span
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, rotate: expanded ? 90 : 0 }}
            transition={{
              opacity: { duration: 0.2, ease: [0.22, 0.61, 0.36, 1] },
              rotate: { type: "spring", stiffness: 480, damping: 32 },
            }}
            className="flex h-4 w-4 items-center justify-center text-neutral-400 dark:text-neutral-500"
          >
            <IconChevronRight size={14} stroke={2.5} />
          </motion.span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {!open && expanded && (
          <motion.div
            key="steps"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.26, ease: [0.22, 0.61, 0.36, 1] },
              opacity: { duration: 0.2, ease: [0.22, 0.61, 0.36, 1] },
            }}
            className="overflow-hidden"
          >
            {/* A rail under the icon column, so the unfolded steps read as
                the chain's contents rather than a fresh set of chips. */}
            <div className="mt-1 mb-0.5 ml-[9px] flex flex-col border-l border-black/[0.08] pl-3.5 dark:border-white/[0.08]">
              {chips.map(({ phase, index }) => (
                <PhaseChip
                  key={`chip-${index}`}
                  phase={phase}
                  live={false}
                  animate
                  onClick={chipClick(phase, index)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
