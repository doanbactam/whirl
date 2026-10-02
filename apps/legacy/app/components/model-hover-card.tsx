import { useEffect, useRef } from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";

import { modelLabel } from "~/data/models";
import type { ModelKey } from "~/data/models";
import { MODEL_TIERS, modelTierFor } from "~/data/model-tiers";

const TEXT_TRANSITION = {
  opacity: { duration: 0.22, ease: [0.22, 0.61, 0.36, 1] as const },
  filter: { duration: 0.22, ease: [0.22, 0.61, 0.36, 1] as const },
  y: { type: "spring" as const, stiffness: 520, damping: 34 },
};

const MODEL_ORDER = MODEL_TIERS.map((m) => m.key);

// Content slides in the direction you moved through the list: hovering a model
// lower down slides the new content up; hovering one higher up slides it down.
const swapVariants: Variants = {
  enter: (dir: number) => ({ opacity: 0, y: dir > 0 ? 6 : -6, filter: "blur(4px)" }),
  center: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: (dir: number) => ({ opacity: 0, y: dir > 0 ? -6 : 6, filter: "blur(4px)" }),
};

function MetricBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full border border-black/[0.08] bg-black/[0.04] dark:border-white/[0.08] dark:bg-white/[0.06]">
        <motion.div
          className="h-full rounded-full bg-neutral-800 dark:bg-neutral-200"
          initial={false}
          animate={{ width: `${Math.max(8, value)}%` }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
        />
      </div>
    </div>
  );
}

export function ModelHoverCard({
  model,
  className,
}: {
  model: ModelKey | null;
  className?: string;
}) {
  const tier = model ? modelTierFor(model) : null;
  const Glyph = tier?.icon ?? null;
  const description = tier?.blurb ?? "";

  // Track which way the hovered model moved through the list so the swap can
  // animate in that direction. Computed during render (before the ref updates)
  // so the very first frame already points the right way.
  const prevModelRef = useRef<ModelKey | null>(null);
  let direction = 1;
  const prevModel = prevModelRef.current;
  if (model && prevModel && model !== prevModel) {
    const from = MODEL_ORDER.indexOf(prevModel);
    const to = MODEL_ORDER.indexOf(model);
    if (from !== -1 && to !== -1) direction = to > from ? 1 : -1;
  }
  useEffect(() => {
    if (model) prevModelRef.current = model;
  }, [model]);

  return (
    <div
      className={`pointer-events-none w-[220px] ${className ?? ""}`}
      aria-hidden={!model}
    >
      <AnimatePresence initial={false}>
        {model && tier ? (
          <motion.div
            key="model-hover-card"
            initial={{ opacity: 0, scale: 0.96, filter: "blur(4px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.96, filter: "blur(4px)" }}
            transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
            className="rounded-2xl border border-black/[0.08] bg-white p-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.1),_0_2px_6px_rgba(0,0,0,0.06)] dark:border-white/[0.08] dark:bg-[#1E1E1E] dark:shadow-[0_10px_30px_rgba(0,0,0,0.5),_0_2px_6px_rgba(0,0,0,0.3)]"
          >
            <div className="min-h-[1.5rem]">
              {/* The clip box is pushed out past the content with negative
                  margins so the blurred swap fades softly instead of being
                  sheared into a hard rectangle at the edges. */}
              <div className="relative -m-3 overflow-hidden p-3">
                <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                  <motion.div
                    key={model}
                    custom={direction}
                    variants={swapVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={TEXT_TRANSITION}
                    className="flex items-center gap-2"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black/[0.05] text-neutral-600 dark:bg-white/[0.08] dark:text-neutral-200">
                      {Glyph && <Glyph size={16} stroke={2} />}
                    </span>
                    <h3 className="text-[17px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                      {modelLabel(model)}
                    </h3>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            <div className="mt-2 min-h-[3.25rem]">
              <div className="relative -m-3 overflow-hidden p-3">
                <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                  <motion.p
                    key={description}
                    custom={direction}
                    variants={swapVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={TEXT_TRANSITION}
                    className="text-[12px] leading-snug text-neutral-600 dark:text-neutral-400"
                  >
                    {description}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>

            <div className="mt-3.5 grid grid-cols-2 gap-3">
              <MetricBar label="Intelligence" value={tier.intelligence} />
              <MetricBar label="Usage" value={tier.usage} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
