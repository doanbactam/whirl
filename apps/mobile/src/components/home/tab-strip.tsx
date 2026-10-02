import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { spring } from "@/lib/motion";
import { REPLACE_IN } from "@/lib/replace";
import { spacing, typography, useTheme } from "@/lib/theme";

export type Tab = { key: string; label: string };

type Span = { x: number; width: number };

type TabStripProps = {
  tabs: readonly Tab[];
  /**
   * Where the pager currently sits, as a fractional tab index. Driven by the
   * scroll offset rather than the settled page, so the pill tracks a drag
   * under the thumb instead of catching up after it.
   */
  progress: SharedValue<number>;
  /** The settled tab. Only for assistive tech — the pill rides `progress`. */
  activeIndex: number;
  onSelect: (index: number) => void;
  /** An action pinned to the end of the strip — not a destination. */
  trailing?: ReactNode;
};

const PILL_HEIGHT = 32;

/** The tab row, with a pane of glass that slides to whichever tab is live. */
export function TabStrip({
  tabs,
  progress,
  activeIndex,
  onSelect,
  trailing,
}: TabStripProps) {
  const [spans, setSpans] = useState<Span[]>([]);

  /* interpolate needs at least two stops, and every stop has to be real —
     a half-measured strip would put the pill somewhere arbitrary. */
  const ready = tabs.length > 1 && spans.filter(Boolean).length === tabs.length;

  /*
   * Two sets of measurements and a crossfade between them.
   *
   * A tab is only as wide as its words, so renaming a thread resizes it — and
   * feeding the new numbers straight to the pill would snap it to the new
   * shape under a label that's still arriving. Springing between the old
   * measurements and the new lets the capsule grow into the name instead.
   *
   * The spring is on the *measurements*, not on the pill's position, so a drag
   * still moves the pill exactly as far as the thumb does.
   */
  const from = useSharedValue<Span[]>([]);
  const to = useSharedValue<Span[]>([]);
  const morph = useSharedValue(1);

  useEffect(() => {
    if (!ready) return;

    // The first measurement has nothing to grow out of — it just lands.
    if (to.value.length !== spans.length) {
      from.value = spans;
      to.value = spans;
      morph.value = 1;
      return;
    }

    from.value = to.value;
    to.value = spans;
    morph.value = 0;
    morph.value = withSpring(1, spring.morph);
  }, [from, morph, ready, spans, to]);

  const measure = (index: number) => (event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    setSpans((previous) => {
      const current = previous[index];
      if (current?.x === x && current?.width === width) return previous;
      const next = [...previous];
      next[index] = { x, width };
      return next;
    });
  };

  const pillStyle = useAnimatedStyle(() => {
    const start = from.value;
    const end = to.value;
    if (end.length < 2) return {};

    const stops = end.map((_, index) => index);
    const blend = (index: number, key: "x" | "width") => {
      const target = end[index][key];
      const origin = start[index] ? start[index][key] : target;
      return origin + (target - origin) * morph.value;
    };

    return {
      transform: [
        {
          translateX: interpolate(
            progress.value,
            stops,
            end.map((_, index) => blend(index, "x")),
            Extrapolation.CLAMP,
          ),
        },
      ],
      width: interpolate(
        progress.value,
        stops,
        end.map((_, index) => blend(index, "width")),
        Extrapolation.CLAMP,
      ),
    };
  });

  return (
    <View style={styles.strip}>
      {/* Rendered only once measured. It can't simply be faded in — alpha
          above a glass pane stops the effect rendering. */}
      {ready ? (
        <Animated.View style={[styles.pillSlot, pillStyle]}>
          <GlassSurface radius={PILL_HEIGHT / 2} style={styles.pill} />
        </Animated.View>
      ) : null}

      {tabs.map((tab, index) => (
        <Pressable
          key={tab.key}
          accessibilityRole="tab"
          accessibilityLabel={tab.label}
          accessibilityState={{ selected: activeIndex === index }}
          onLayout={measure(index)}
          onPress={() => onSelect(index)}
          style={styles.tab}
        >
          <TabLabel label={tab.label} index={index} progress={progress} />
        </Pressable>
      ))}

      {trailing}
    </View>
  );
}

/** A tab's words, inking up as the pill arrives under them. */
function TabLabel({
  label,
  index,
  progress,
}: {
  label: string;
  index: number;
  progress: SharedValue<number>;
}) {
  const { colors } = useTheme();

  const style = useAnimatedStyle(() => ({
    color: interpolateColor(
      Math.min(Math.abs(progress.value - index), 1),
      [0, 1],
      [colors.foreground, colors.foregroundSoft],
    ),
  }));

  return (
    /* Keyed on the words, so a rename replaces them rather than swapping the
       characters out from under you. Only an entrance: the outgoing label has
       to leave the layout at once or the tab would measure to whichever name
       is longer, and the pill would grow to fit a word already on its way out.

       Safe to fade — the label is a sibling of the pill, not a child of it. */
    <Animated.Text
      key={label}
      entering={REPLACE_IN}
      numberOfLines={1}
      style={[typography.label, style]}
    >
      {label}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  strip: {
    // Takes what the avatar and the action button leave, and centres in it.
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  pillSlot: {
    position: "absolute",
    left: 0,
    height: PILL_HEIGHT,
  },
  pill: {
    flex: 1,
  },
  tab: {
    height: PILL_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: spacing.sm + 2,
    /* The thread tab wears a title of any length, so tabs give way rather
       than pushing the trailing action off the end of the row. */
    flexShrink: 1,
  },
});
