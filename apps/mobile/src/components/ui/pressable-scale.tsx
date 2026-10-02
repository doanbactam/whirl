import type { ReactNode } from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";

import { usePress } from "@/lib/press";

type PressableScaleProps = {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  /** Visual + layout style; lives on the pressable, not the scaling wrapper. */
  style?: StyleProp<ViewStyle>;
  /** How far in the press sinks. Bigger surfaces want a subtler dip. */
  scaleTo?: number;
  haptic?: boolean;
  accessibilityLabel?: string;
};

/**
 * A pressable that dips while held. Controls that need more than the dip —
 * a glass button also takes a wash, since a native pane can't be dimmed —
 * should reach for `usePress` directly instead of wrapping this.
 */
export function PressableScale({
  children,
  onPress,
  disabled = false,
  style,
  scaleTo = 0.97,
  haptic = true,
  accessibilityLabel,
}: PressableScaleProps) {
  const { handlers, scaleStyle, tapped } = usePress({ scaleTo, haptic });

  return (
    <Animated.View style={scaleStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          tapped();
          onPress?.();
        }}
        style={style}
        {...handlers}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
