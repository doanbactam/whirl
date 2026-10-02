import { useEffect, type ComponentType } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { duration, ease } from "@/lib/motion";
import { usePress } from "@/lib/press";
import { radius, size, spacing, typography, useTheme } from "@/lib/theme";

export type ButtonVariant = "primary" | "secondary";

type IconProps = { size: number; color: string };

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  /** A Tabler icon component, drawn to the left of the label. */
  icon?: ComponentType<IconProps>;
};

/** How far the label recedes as the spinner takes over from it. */
const LABEL_RECEDE = 0.06;

/**
 * A glass capsule. The primary variant is tinted with the app's ink so it
 * still leads the screen; the secondary one takes the neutral tint.
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  icon: Icon,
}: ButtonProps) {
  const { colors } = useTheme();
  const isPrimary = variant === "primary";
  const isBlocked = disabled || loading;

  const foreground = isPrimary ? colors.primaryForeground : colors.foreground;

  /* A dark capsule can't be darkened any further, so the primary press wash
     lifts instead — the same gesture read the other way round. */
  const wash = isPrimary ? colors.primaryForeground : colors.glassPress;

  const { handlers, scaleStyle, washStyle, tapped } = usePress({
    washTo: isPrimary ? 0.14 : 1,
  });

  /* One driver for the whole busy/blocked state, so the label's fade, the
     spinner's arrival, and the dimming can't land at different moments. */
  const busy = useSharedValue(loading ? 1 : 0);
  const blocked = useSharedValue(isBlocked ? 1 : 0);

  useEffect(() => {
    busy.value = withTiming(loading ? 1 : 0, {
      duration: duration.fast,
      easing: ease,
    });
  }, [busy, loading]);

  useEffect(() => {
    blocked.value = withTiming(isBlocked ? 1 : 0, {
      duration: duration.fast,
      easing: ease,
    });
  }, [blocked, isBlocked]);

  /* The dim lands on the contents, never on the capsule. Alpha below 1 on a
     glass pane or anything above it stops the effect rendering — Apple's own
     guidance — so a disabled button greys its label and keeps its material. */
  const labelStyle = useAnimatedStyle(() => ({
    opacity: (1 - busy.value) * (1 - blocked.value * 0.55),
    transform: [{ scale: 1 - busy.value * LABEL_RECEDE }],
  }));

  const spinnerStyle = useAnimatedStyle(() => ({
    opacity: busy.value,
    transform: [{ scale: 1 - (1 - busy.value) * LABEL_RECEDE }],
  }));

  return (
    <Animated.View style={scaleStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isBlocked, busy: loading }}
        disabled={isBlocked}
        onPress={() => {
          tapped();
          onPress();
        }}
        {...handlers}
      >
        <GlassSurface
          radius={radius.control}
          interactive
          tint={isPrimary ? colors.primaryGlass : undefined}
          fallback={isPrimary ? colors.primary : colors.glassFill}
          style={styles.button}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              washStyle,
              { backgroundColor: wash, borderRadius: radius.control },
            ]}
          />

          <Animated.View style={[styles.content, labelStyle]}>
            {Icon ? <Icon size={20} color={foreground} /> : null}
            <Text style={[typography.button, { color: foreground }]}>
              {label}
            </Text>
          </Animated.View>

          {/* Overlaid rather than swapped in, so the capsule never resizes. */}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.center, spinnerStyle]}
          >
            <ActivityIndicator color={foreground} />
          </Animated.View>
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    height: size.control,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    // Clips the press wash to the capsule.
    overflow: "hidden",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
});
