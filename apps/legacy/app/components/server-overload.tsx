import { useEffect } from "react";
import { motion } from "motion/react";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useCustomer } from "autumn-js/react";

import { readFreeMessages } from "~/lib/messages";
import { isServerOverloaded, useServerLoad } from "~/lib/server-load";
import { useAuthGate } from "~/lib/auth-gate";
import { useUpgrade } from "~/components/upgrade-modal";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

// Deliberately vague about the cause (a cost-control throttle), but it doubles
// as an upgrade nudge: paid plans get priority when we're busy. Proper casing
// per app copy conventions.
export const SERVER_OVERLOAD_COPY = {
  headline: "Our servers are under extra load right now",
  sub: "Paid plans get priority access when we're busy.",
  retry: "Please try again in a little while.",
  cta: "Upgrade for priority",
} as const;

// Effective free-message allowance while throttled: how many of the tightened
// daily `cap` the user has left, given how many they've already spent (`used`,
// read from the Autumn meter). Clamped to 0. Returns null when we don't yet have
// both numbers, so callers can fall back to vague copy.
export function overloadRemaining(
  cap: number | null | undefined,
  used: number,
): number | null {
  if (typeof cap !== "number") return null;
  return Math.max(0, cap - used);
}

// Compact "N of M messages left" phrase for the pill, or the all-spent variant.
function allowanceLabel(remaining: number, cap: number): string {
  const noun = cap === 1 ? "message" : "messages";
  return remaining <= 0
    ? `no ${noun} left while we're busy`
    : `${remaining} of ${cap} ${noun} left while we're busy`;
}

const PILL_BASE =
  "group inline-flex items-center gap-1.5 rounded-full border border-amber-300/60 bg-amber-50/90 px-2.5 py-1 text-[12px] font-medium text-amber-800 shadow-sm backdrop-blur transition dark:border-amber-400/20 dark:bg-amber-500/[0.12] dark:text-amber-200";

/**
 * The visual overload pill — an amber status chip that shows the reduced
 * allowance and nudges toward priority access. When `onUpgrade` is given it
 * renders as a button (used live under the composer); without it, a static chip
 * (used in previews). Pass `remaining`/`cap` to show "N of M messages left";
 * omit them to fall back to the vague headline. Kept free of any positioning so
 * it can sit in the floating composer slot (via {@link ServerOverloadNotice}) or
 * inline in previews.
 */
export function ServerOverloadPill({
  onUpgrade,
  remaining,
  cap,
}: {
  onUpgrade?: () => void;
  remaining?: number | null;
  cap?: number | null;
}) {
  const motionProps = {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 4 },
    transition: {
      duration: 0.18,
      ease: [0.22, 0.61, 0.36, 1] as [number, number, number, number],
    },
  };
  const label =
    typeof remaining === "number" && typeof cap === "number"
      ? allowanceLabel(remaining, cap)
      : SERVER_OVERLOAD_COPY.headline;
  const inner = (
    <>
      <IconAlertTriangle
        size={13}
        stroke={2}
        className="shrink-0 opacity-90"
      />
      <span>{label}</span>
      <span className="font-semibold text-[#0c82f2]">
        {SERVER_OVERLOAD_COPY.cta}
      </span>
    </>
  );

  if (onUpgrade) {
    return (
      <motion.button
        {...motionProps}
        type="button"
        onClick={onUpgrade}
        className={`${PILL_BASE} pointer-events-auto hover:bg-amber-50 dark:hover:bg-amber-500/[0.18]`}
      >
        {inner}
      </motion.button>
    );
  }

  return (
    <motion.div {...motionProps} role="status" aria-live="polite" className={PILL_BASE}>
      {inner}
    </motion.div>
  );
}

/**
 * Floating overload notice shown under the composer for free users while the
 * server is throttling. Mirrors FreeMessagesPill's placement so the two occupy
 * the same slot (the free-messages pill yields to this when overloaded). Pass
 * `forceLevel` to preview it regardless of live state (used by the debug page).
 */
export function ServerOverloadNotice({
  above = false,
  lift = false,
  forceLevel,
}: {
  above?: boolean;
  lift?: boolean;
  forceLevel?: number;
}) {
  const { customer, isLoading } = useCustomer();
  const { isSignedIn } = useAuthGate();
  const { open: openUpgrade } = useUpgrade();
  const load = useServerLoad();
  const capture = useCapture();
  const { isFree, used } = readFreeMessages(customer);

  const cap = load?.cap ?? null;
  const remaining = overloadRemaining(cap, used);
  const preview = forceLevel !== undefined;
  const show = preview
    ? forceLevel > 0
    : isSignedIn &&
      !(isLoading && !customer) &&
      isFree &&
      isServerOverloaded(load);

  // Fire once whenever the notice transitions into view (live only).
  useEffect(() => {
    if (show && !preview) {
      capture(ANALYTICS_EVENTS.serverOverloadShown, { level: load?.level });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, preview]);

  if (!show) return null;

  // Same anchoring logic as FreeMessagesPill so they never both float at once.
  const placement = above
    ? lift
      ? "bottom-full mb-14"
      : "bottom-full mb-2"
    : "top-full mt-2";

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-0 flex justify-center ${placement}`}
    >
      <ServerOverloadPill
        onUpgrade={() => openUpgrade("priority")}
        remaining={remaining}
        cap={cap}
      />
    </div>
  );
}

/**
 * In-thread banner shown in place of an assistant reply that the overload
 * throttle turned away. A transient "we're busy" state — the message can be
 * retried — that also nudges toward paid plans' priority access.
 */
export function ServerOverloadBanner() {
  const { open: openUpgrade } = useUpgrade();
  const { customer } = useCustomer();
  const load = useServerLoad();
  const { used } = readFreeMessages(customer);

  const cap = load?.cap ?? null;
  const remaining = overloadRemaining(cap, used);
  // Spell out the reduced daily allowance when we know it; otherwise stay vague.
  const sub =
    typeof cap === "number"
      ? `${
          remaining && remaining > 0
            ? `You have ${remaining} of ${cap} ${cap === 1 ? "message" : "messages"} left today.`
            : `Free messages are limited to ${cap} a day right now.`
        } ${SERVER_OVERLOAD_COPY.sub}`
      : `${SERVER_OVERLOAD_COPY.sub} ${SERVER_OVERLOAD_COPY.retry}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
      className="flex max-w-full min-w-0 items-start gap-2.5 rounded-2xl border border-black/[0.08] bg-black/[0.03] px-3.5 py-2.5 dark:border-white/[0.08] dark:bg-white/[0.04]"
    >
      <IconAlertTriangle
        size={16}
        stroke={2}
        className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
      />
      <div className="flex min-w-0 flex-col items-start gap-2">
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-100">
            {SERVER_OVERLOAD_COPY.headline}
          </span>
          <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
            {sub}
          </span>
        </div>
        <button
          type="button"
          onClick={() => openUpgrade("priority")}
          className="inline-flex h-7 items-center rounded-lg bg-[#0c82f2] px-2.5 text-[12px] font-medium text-white transition hover:bg-[#0a6fd0]"
        >
          {SERVER_OVERLOAD_COPY.cta}
        </button>
      </div>
    </motion.div>
  );
}
