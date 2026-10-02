import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { spring } from "@/lib/motion";

type PressOptions = {
  /** How far in the press sinks. Bigger surfaces want a subtler dip. */
  scaleTo?: number;
  /** Peak opacity of the press wash. */
  washTo?: number;
  haptic?: boolean;
};

/**
 * The press response, as a hook rather than a component, so a control can wire
 * the same driver into more than one thing — a glass button dips *and* takes a
 * wash, because a native glass pane can't be dimmed the way a solid fill can.
 *
 * Everything runs on the UI thread, so the dip stays smooth even while the JS
 * thread is busy with an auth request.
 */
export function usePress({
  scaleTo = 0.97,
  washTo = 1,
  haptic = true,
}: PressOptions = {}) {
  const held = useSharedValue(0);

  /* One driver, sprung once here rather than inside each animated style — two
     springs fed from the same boolean would drift apart under a fast tap. */
  const progress = useDerivedValue(() => withSpring(held.value, spring.press));

  const scaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - scaleTo) * progress.value }],
  }));

  /** Opacity for an overlay laid across the control while it's held. */
  const washStyle = useAnimatedStyle(() => ({
    opacity: progress.value * washTo,
  }));

  const handlers = {
    onPressIn: () => {
      held.value = 1;
    },
    onPressOut: () => {
      held.value = 0;
    },
  };

  const tapped = () => {
    if (!haptic || Platform.OS === "web") return;
    // Fire and forget — a failed haptic must never block the action.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  /* `progress` is handed back so a control with a response of its own — text
     that dims rather than a surface that washes — can drive it off the same
     spring instead of starting a second one. */
  return { handlers, progress, scaleStyle, washStyle, tapped };
}
