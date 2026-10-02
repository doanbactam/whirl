import { forwardRef, useEffect, useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { IconEyeClosed, IconEyeFilled } from "@tabler/icons-react-native";
import Animated, {
  FadeInDown,
  FadeOut,
  interpolateColor,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { duration, ease, spring } from "@/lib/motion";
import { radius, size, spacing, typography, useTheme } from "@/lib/theme";

type TextFieldProps = TextInputProps & {
  label: string;
  /** Field-level message from Clerk; also turns the border red. */
  error?: string | null;
  /** Renders as a password field with a reveal toggle. */
  secure?: boolean;
};

/** How far the field kicks when a new error lands on it. */
const SHAKE = 7;

export const TextField = forwardRef<TextInput, TextFieldProps>(
  (
    { label, error, secure = false, style, onFocus, onBlur, ...inputProps },
    ref,
  ) => {
    const { colors } = useTheme();
    const [focused, setFocused] = useState(false);
    const [revealed, setRevealed] = useState(false);

    const focus = useSharedValue(0);
    const alarm = useSharedValue(error ? 1 : 0);
    const shake = useSharedValue(0);

    useEffect(() => {
      focus.value = withTiming(focused ? 1 : 0, {
        duration: duration.base,
        easing: ease,
      });
    }, [focus, focused]);

    useEffect(() => {
      alarm.value = withTiming(error ? 1 : 0, {
        duration: duration.fast,
        easing: ease,
      });

      // Only a *new* problem is worth interrupting the user for.
      if (!error) return;
      shake.value = withSequence(
        withTiming(-SHAKE, { duration: 55 }),
        withTiming(SHAKE, { duration: 70 }),
        withTiming(-SHAKE * 0.5, { duration: 60 }),
        withSpring(0, spring.press),
      );
    }, [alarm, error, shake]);

    /* Error outranks focus — a red field shouldn't turn neutral just because
       the user tapped back into it to fix the mistake. */
    const capsuleStyle = useAnimatedStyle(() => ({
      transform: [{ translateX: shake.value }],
      borderColor: interpolateColor(
        alarm.value,
        [0, 1],
        [
          interpolateColor(
            focus.value,
            [0, 1],
            [colors.glassRim, colors.foreground],
          ),
          colors.danger,
        ],
      ),
    }));

    const labelStyle = useAnimatedStyle(() => ({
      color: interpolateColor(
        alarm.value,
        [0, 1],
        [
          interpolateColor(
            focus.value,
            [0, 1],
            [colors.foregroundSoft, colors.foreground],
          ),
          colors.danger,
        ],
      ),
    }));

    const RevealIcon = revealed ? IconEyeFilled : IconEyeClosed;

    return (
      <Animated.View style={styles.field} layout={LinearTransition.springify()}>
        <Animated.Text style={[typography.label, labelStyle]}>
          {label}
        </Animated.Text>

        <GlassSurface
          radius={radius.control}
          rim={false}
          style={[styles.capsule, capsuleStyle]}
        >
          <TextInput
            ref={ref}
            style={[
              styles.input,
              typography.body,
              { color: colors.foreground },
              style,
            ]}
            placeholderTextColor={colors.foregroundMuted}
            secureTextEntry={secure && !revealed}
            onFocus={(event) => {
              setFocused(true);
              onFocus?.(event);
            }}
            onBlur={(event) => {
              setFocused(false);
              onBlur?.(event);
            }}
            {...inputProps}
          />

          {secure ? (
            <RevealToggle
              revealed={revealed}
              onPress={() => setRevealed((shown) => !shown)}
            >
              <RevealIcon size={20} color={colors.foregroundMuted} />
            </RevealToggle>
          ) : null}
        </GlassSurface>

        {error ? (
          <Animated.Text
            entering={FadeInDown.duration(duration.base)}
            exiting={FadeOut.duration(duration.fast)}
            style={[typography.caption, { color: colors.danger }]}
          >
            {error}
          </Animated.Text>
        ) : null}
      </Animated.View>
    );
  },
);

TextField.displayName = "TextField";

/** The eye. Spins a half-turn on each tap so the state change is legible. */
function RevealToggle({
  revealed,
  onPress,
  children,
}: {
  revealed: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const flip = useSharedValue(0);

  useEffect(() => {
    flip.value = withSpring(revealed ? 1 : 0, spring.settle);
  }, [flip, revealed]);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${flip.value * 180}deg` }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={revealed ? "Hide password" : "Show password"}
      hitSlop={spacing.md}
      onPress={onPress}
      style={styles.reveal}
    >
      <Animated.View style={style}>{children}</Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  capsule: {
    flexDirection: "row",
    alignItems: "center",
    height: size.control,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg + spacing.xs,
  },
  input: {
    flex: 1,
    // Android centers text oddly inside a fixed-height row without this.
    paddingVertical: 0,
  },
  reveal: {
    paddingLeft: spacing.md,
  },
});
