import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import { usePress } from "@/lib/press";
import { spacing, typography, useTheme } from "@/lib/theme";

type TextLinkProps = {
  /** Muted lead-in, e.g. "Don't have an account?" */
  prompt?: string;
  label: string;
  onPress: () => void;
};

/** An inline text action — the quiet counterpart to a Button. */
export function TextLink({ prompt, label, onPress }: TextLinkProps) {
  const { colors } = useTheme();
  /* Text has no surface to dip, so the press reads through the label itself:
     a shallower scale than a button's, and a fade to match. */
  const { handlers, progress, tapped } = usePress({
    scaleTo: 0.94,
    haptic: false,
  });

  const labelStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value * 0.45,
    transform: [{ scale: 1 - progress.value * 0.06 }],
  }));

  return (
    <View style={styles.row}>
      {prompt ? (
        <Text style={[typography.caption, { color: colors.foregroundMuted }]}>
          {prompt}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label}
        hitSlop={spacing.md}
        onPress={() => {
          tapped();
          onPress();
        }}
        {...handlers}
      >
        <Animated.Text
          style={[
            typography.caption,
            styles.label,
            labelStyle,
            { color: colors.foreground },
          ]}
        >
          {label}
        </Animated.Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.xs + 2,
  },
  label: {
    fontWeight: "600",
  },
});
