import { useState } from "react";
import { Platform, StyleSheet } from "react-native";
import { IconPencilPlus } from "@tabler/icons-react-native";
import * as Haptics from "expo-haptics";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { spacing, useTheme } from "@/lib/theme";

const BADGE = 48;

/** How far past the last page you have to pull before releasing counts. */
export const PULL_THRESHOLD = 82;

type NewThreadPullProps = {
  /** How far past the last page the pager has been dragged, in points. */
  pull: SharedValue<number>;
  /**
   * The same lift the greeting rides. Pinning to half the pager would centre
   * the badge against the area behind the composer too, leaving it sitting
   * low and unmoved when the keyboard pushes everything else up. Sharing the
   * number keeps it on the greeting's line in every state.
   */
  lift: SharedValue<number>;
};

/* Above the component, like anything a worklet reaches for: a worklet captures
   what it names at the moment it's built, so a binding declared further down
   is still in its dead zone by then. */
function thud() {
  if (Platform.OS === "web") return;
  // Fire and forget — a failed haptic must never hold up the gesture.
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/**
 * The affordance behind pulling right off the end of the pager.
 *
 * It rides the drag rather than appearing on a timer: it comes in from the
 * edge as you pull, and firms up once you're far enough that letting go will
 * open a new thread. Sits where "+ New" sits in the strip above, which is what
 * the gesture is a shortcut for.
 */
export function NewThreadPull({ pull, lift }: NewThreadPullProps) {
  const { colors } = useTheme();
  const [armed, setArmed] = useState(false);

  /* Crossing the line is worth saying out loud — you're looking at your thumb,
     not at the edge of the screen. The tint needs JS anyway: it's a native
     prop on the pane, not something a worklet can set. */
  useAnimatedReaction(
    () => pull.value >= PULL_THRESHOLD,
    (past, previous) => {
      if (previous === null || past === previous) return;
      runOnJS(setArmed)(past);
      if (past) runOnJS(thud)();
    },
  );

  const style = useAnimatedStyle(() => ({
    transform: [
      // Up onto the greeting's line, before anything the drag does.
      { translateY: -lift.value },
      {
        /* Parked off the edge rather than faded out — alpha anywhere above a
           glass pane stops the effect rendering. */
        translateX: interpolate(
          pull.value,
          [0, PULL_THRESHOLD],
          [BADGE + spacing.xl, 0],
          Extrapolation.CLAMP,
        ),
      },
      {
        scale: interpolate(
          pull.value,
          [0, PULL_THRESHOLD, PULL_THRESHOLD * 1.6],
          [0.85, 1, 1.08],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.slot, style]}>
      <GlassSurface
        radius={BADGE / 2}
        tint={armed ? colors.primaryGlass : undefined}
        fallback={armed ? colors.primary : undefined}
        style={styles.badge}
      >
        <IconPencilPlus
          size={22}
          color={armed ? colors.primaryForeground : colors.foreground}
        />
      </GlassSurface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slot: {
    position: "absolute",
    right: spacing.lg,
    // Centred against the pager it belongs to, not the whole screen.
    top: "50%",
    marginTop: -BADGE / 2,
  },
  badge: {
    width: BADGE,
    height: BADGE,
    alignItems: "center",
    justifyContent: "center",
  },
});
