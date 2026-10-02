import type { ComponentType } from "react";
import { StyleSheet } from "react-native";
import Animated from "react-native-reanimated";

import { REPLACE_IN, REPLACE_OUT } from "@/lib/replace";

type IconProps = { size: number; color: string };

type SwapIconProps = {
  icon: ComponentType<IconProps>;
  /** Identity of the current glyph. Changing it plays the replace. */
  name: string;
  size: number;
  color: string;
};

/**
 * An icon that's replaced rather than swapped out.
 *
 * Safe to cross-fade even on a glass button: the glyph is a *child* of the
 * pane, not an ancestor, so its alpha never reaches the effect.
 */
export function SwapIcon({ icon: Icon, name, size, color }: SwapIconProps) {
  return (
    <Animated.View style={[{ width: size, height: size }, styles.centre]}>
      {/* Absolutely placed so the two glyphs sit on top of each other through
          the change instead of shoving each other sideways. */}
      <Animated.View
        key={name}
        entering={REPLACE_IN}
        exiting={REPLACE_OUT}
        style={[StyleSheet.absoluteFill, styles.centre]}
      >
        <Icon size={size} color={color} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  centre: {
    alignItems: "center",
    justifyContent: "center",
  },
});
