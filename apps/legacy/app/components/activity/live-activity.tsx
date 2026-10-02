import { AnimatePresence, motion } from "motion/react";

import { ACTIVITIES, type ActivityKind } from "./activity-kinds";
import { RotatingVerb } from "./rotating-verb";

/**
 * The single live "the model is busy" row: a gently breathing icon next to a
 * rotating whimsical verb. There is only ever one of these on screen at a time;
 * as the model moves between activities (thinking → searching → …) the icon
 * crossfades and the verb pool swaps in place — the row itself never remounts,
 * so the whole thing flows instead of cutting.
 */
// Bare, text-free loading state: three dots that brighten in sequence. The
// pulse is a CSS animation (see .loading-dot) rather than a JS one — the message
// bubble re-renders constantly while streaming, which would otherwise restart a
// framer keyframe every render and leave the dots looking frozen.
function LoadingDots() {
  return (
    <div className="flex h-7 items-center gap-1.5 pt-0.5" aria-label="Loading" role="status">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="loading-dot h-1.5 w-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  );
}

export function LiveActivity({ kind }: { kind: ActivityKind }) {
  if (kind === "loading") return <LoadingDots />;
  const def = ACTIVITIES[kind];
  const Glyph = def.icon;
  return (
    <div className="flex items-center gap-2 py-0.5">
      <motion.span
        aria-hidden
        animate={{ scale: [1, 1.12, 1], rotate: [0, 4, -4, 0] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        className="relative flex h-5 w-5 items-center justify-center text-neutral-500 dark:text-neutral-400"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={kind}
            initial={{ opacity: 0, scale: 0.5, rotate: -40 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.5, rotate: 40 }}
            transition={{ type: "spring", stiffness: 460, damping: 30 }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <Glyph size={16} stroke={2} />
          </motion.span>
        </AnimatePresence>
      </motion.span>
      <RotatingVerb verbs={def.verbs} />
    </div>
  );
}
