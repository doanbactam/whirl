import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

// Matches the .shimmer-loop cycle in app.css exactly: each verb's span is
// keyed by its text, so a swap remounts it and restarts the sweep animation
// from zero — every verb gets precisely three shimmer passes before the next
// one takes over. Change one duration and you must change the other.
const VERB_INTERVAL_MS = 3000;

function pick(verbs: string[], avoid?: string) {
  if (verbs.length <= 1) return verbs[0] ?? "";
  let next = verbs[Math.floor(Math.random() * verbs.length)];
  if (next === avoid) {
    next = verbs[(verbs.indexOf(next) + 1) % verbs.length];
  }
  return next;
}

/**
 * A verb from the pool that reshuffles every couple of seconds — and jumps to a
 * fresh pick the moment the pool itself changes (thinking → searching), so the
 * switch reads immediately. `active: false` freezes the rotation: the current
 * verb holds still so a finalized label can morph in over it without the verb
 * swapping underneath mid-transition.
 */
export function useRotatingVerb(verbs: string[], active = true) {
  const [verb, setVerb] = useState(() => pick(verbs));
  const verbRef = useRef(verb);
  verbRef.current = verb;
  const mounted = useRef(false);

  useEffect(() => {
    if (!active) return;
    // On a genuine pool switch, jump straight to a verb from the new pool so
    // the change reads as "now it's searching" rather than waiting a tick.
    if (mounted.current) {
      const fresh = pick(verbs);
      verbRef.current = fresh;
      setVerb(fresh);
    }
    mounted.current = true;

    const id = setInterval(() => {
      const next = pick(verbs, verbRef.current);
      verbRef.current = next;
      setVerb(next);
    }, VERB_INTERVAL_MS);
    return () => clearInterval(id);
  }, [verbs, active]);

  return verb;
}

/**
 * A text slot that animates *every* change of its `text` — the same y+blur
 * swap everywhere a live label rotates or settles. Because the slot itself
 * never unmounts, a pending verb morphing into a finalized label ("Sniffing
 * around…" → "Searched 5 sources") flows instead of cutting. `shimmer` runs
 * the looping text sheen while work is in flight; drop it and the entering
 * text renders in plain ink.
 */
export function LabelMorph({
  text,
  shimmer = false,
  ellipsis = false,
  initial = true,
  className = "text-[14px] leading-6",
}: {
  text: string;
  shimmer?: boolean;
  /** Trailing "…" rendered aria-hidden so screen readers skip it. */
  ellipsis?: boolean;
  /** Animate the very first text in? Later changes always animate. */
  initial?: boolean;
  className?: string;
}) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <AnimatePresence mode="popLayout" initial={initial}>
        <motion.span
          key={text}
          initial={{ opacity: 0, y: 8, filter: "blur(5px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -8, filter: "blur(5px)" }}
          transition={{
            opacity: { duration: 0.26, ease: [0.22, 0.61, 0.36, 1] },
            filter: { duration: 0.26, ease: [0.22, 0.61, 0.36, 1] },
            y: { type: "spring", stiffness: 520, damping: 34 },
          }}
          className={`inline-block whitespace-nowrap ${
            shimmer ? "shimmer-loop" : ""
          }`}
        >
          {text}
          {ellipsis && <span aria-hidden>…</span>}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * A single rotating verb that animates every change — the periodic shuffle,
 * and the swap when the verb pool changes underneath it (e.g. thinking →
 * searching). The component never unmounts across those transitions, so the
 * rotation stays continuous and never hard-cuts.
 */
export function RotatingVerb({ verbs }: { verbs: string[] }) {
  const verb = useRotatingVerb(verbs);
  return <LabelMorph text={verb} ellipsis shimmer />;
}
