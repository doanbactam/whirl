import { Easing, Keyframe } from "react-native-reanimated";

/*
 * iOS 26 replaces content by softening the old away and bringing the new up in
 * its place — the two overlap, neither one travels.
 *
 * React Native can't blur a view's own content, so scale carries the softening
 * instead: a little further than a real blur-replace moves, because it's doing
 * two jobs. Shared so an icon and the words under it change the same way.
 *
 * Both are safe over glass *as children of a pane* — the alpha is on the
 * content, never on an ancestor of the effect.
 */
const SHRUNK = 0.78;

export const REPLACE_IN = new Keyframe({
  0: { opacity: 0, transform: [{ scale: SHRUNK }] },
  100: {
    opacity: 1,
    transform: [{ scale: 1 }],
    easing: Easing.out(Easing.cubic),
  },
}).duration(240);

export const REPLACE_OUT = new Keyframe({
  0: { opacity: 1, transform: [{ scale: 1 }] },
  100: {
    opacity: 0,
    transform: [{ scale: SHRUNK }],
    easing: Easing.in(Easing.cubic),
  },
}).duration(170);
