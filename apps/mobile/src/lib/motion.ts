import { Easing } from "react-native-reanimated";

/**
 * One vocabulary of springs and timings for the whole app. Motion that shares
 * a curve reads as one system; motion that doesn't reads as jank, so reach for
 * a name here rather than hand-tuning a config at the call site.
 */

export const spring = {
  /** A press should feel answered, not animated at — fast, no overshoot. */
  press: { damping: 22, stiffness: 420, mass: 0.5 },
  /** Things arriving and settling. A little overshoot gives them weight. */
  settle: { damping: 17, stiffness: 190, mass: 0.9 },
  /** Layout morphs — slower, because the eye has to follow the whole shape. */
  morph: { damping: 20, stiffness: 150, mass: 1 },
} as const;

export const duration = {
  fast: 160,
  base: 280,
  slow: 460,
} as const;

/** Apple's workhorse curve: leaves quickly, lands softly. */
export const ease = Easing.bezier(0.22, 0.8, 0.24, 1);

/** Gap between siblings in a staggered entrance. */
export const STAGGER_STEP = 55;
