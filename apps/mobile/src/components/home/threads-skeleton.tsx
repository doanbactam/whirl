import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { ROW_HEIGHT } from "@/components/home/thread-row";
import { radius, spacing, useTheme } from "@/lib/theme";

/** Title lengths, so the placeholder reads as a list rather than a barcode. */
const WIDTHS = [0.72, 0.54, 0.83, 0.46, 0.66, 0.78, 0.5, 0.62, 0.74, 0.58];

/**
 * The shape of the list, while the list is on its way.
 *
 * A spinner in the middle of the page would say "something is happening";
 * this says "your threads are about to be here", and lands without the layout
 * jumping when they are.
 */
export function ThreadsSkeleton() {
  const { colors } = useTheme();

  /* One driver for every bar. Ten independent timers would drift apart within
     a second and start to twinkle. */
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value * 0.5 }));

  return (
    <View style={styles.list} pointerEvents="none">
      <Animated.View
        style={[styles.header, style, { backgroundColor: colors.input }]}
      />
      {WIDTHS.map((width, index) => (
        <View key={index} style={styles.row}>
          <Animated.View
            style={[
              styles.bar,
              style,
              { width: `${width * 100}%`, backgroundColor: colors.input },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingTop: spacing.lg,
  },
  header: {
    height: 11,
    width: 62,
    marginLeft: spacing.xl,
    marginBottom: spacing.md,
    borderRadius: radius.controlSmall,
  },
  row: {
    height: ROW_HEIGHT,
    justifyContent: "center",
    // Matches the row's own padding, so nothing shifts sideways on swap.
    paddingHorizontal: spacing.md + spacing.md,
  },
  bar: {
    height: 13,
    borderRadius: radius.controlSmall,
  },
});
