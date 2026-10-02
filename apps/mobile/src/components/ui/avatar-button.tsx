import { Image, Pressable, StyleSheet, Text } from "react-native";
import Animated from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { usePress } from "@/lib/press";
import { typography, useTheme } from "@/lib/theme";

type AvatarButtonProps = {
  /** The user's picture. Falls back to initials when they haven't set one. */
  uri?: string | null;
  initials: string;
  onPress: () => void;
  label: string;
  size?: number;
};

const DEFAULT_SIZE = 40;

/** How much glass shows around the picture. Enough to read as a rim. */
const RING = 3;

/** The user's face, set into a pane of glass. */
export function AvatarButton({
  uri,
  initials,
  onPress,
  label,
  size = DEFAULT_SIZE,
}: AvatarButtonProps) {
  const { colors } = useTheme();
  const { handlers, scaleStyle, washStyle, tapped } = usePress({
    scaleTo: 0.9,
  });

  const radius = size / 2;
  const inner = size - RING * 2;

  return (
    <Animated.View style={scaleStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => {
          tapped();
          onPress();
        }}
        {...handlers}
      >
        <GlassSurface
          radius={radius}
          interactive
          style={[styles.avatar, { width: size, height: size }]}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              washStyle,
              { borderRadius: radius, backgroundColor: colors.glassPress },
            ]}
          />

          {uri ? (
            <Image
              source={{ uri }}
              style={{
                width: inner,
                height: inner,
                borderRadius: inner / 2,
              }}
            />
          ) : (
            <Text style={[typography.label, { color: colors.foreground }]}>
              {initials}
            </Text>
          )}
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
