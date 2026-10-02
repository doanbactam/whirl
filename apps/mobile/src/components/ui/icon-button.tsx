import type { ComponentType } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { SwapIcon } from "@/components/ui/swap-icon";
import { usePress } from "@/lib/press";
import { useTheme } from "@/lib/theme";

type IconProps = { size: number; color: string };

type IconButtonProps = {
  icon: ComponentType<IconProps>;
  onPress: () => void;
  /** Spoken label — these buttons never carry text. */
  label: string;
  /**
   * Identity of the glyph. Give it when the same button changes what it does —
   * the icon then turns over into the new one instead of blinking.
   */
  iconName?: string;
  /** Diameter. The radius is always half of it: these are circles. */
  size?: number;
  /**
   * `glass` for a button standing on the background. `solid` for one standing
   * on another pane — glass on glass is the one thing the material can't do,
   * so a control inside the composer bar takes a plain fill instead.
   */
  surface?: "glass" | "solid";
  /** Tints the button with the app's ink — a toggle that's on, a live send. */
  active?: boolean;
  disabled?: boolean;
};

const DEFAULT_SIZE = 40;

/** A circular button with a glyph on it. The app's workhorse control. */
export function IconButton({
  icon: Icon,
  onPress,
  label,
  iconName,
  size = DEFAULT_SIZE,
  surface = "glass",
  active = false,
  disabled = false,
}: IconButtonProps) {
  const { colors } = useTheme();
  const { handlers, scaleStyle, washStyle, tapped } = usePress({
    scaleTo: 0.9,
    // A tinted button is already dark; its wash lifts rather than deepens.
    washTo: active ? 0.16 : 1,
  });

  const foreground = active ? colors.primaryForeground : colors.foreground;
  const radius = size / 2;

  const body = (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          washStyle,
          {
            borderRadius: radius,
            backgroundColor: active
              ? colors.primaryForeground
              : colors.glassPress,
          },
        ]}
      />

      {/* The dim rides the glyph, never the pane: alpha below 1 anywhere above
          a glass surface stops the effect rendering. */}
      <Animated.View style={{ opacity: disabled ? 0.35 : 1 }}>
        <SwapIcon
          icon={Icon}
          // A constant keeps a button whose glyph never changes from swapping.
          name={iconName ?? "glyph"}
          size={Math.round(size * 0.46)}
          color={foreground}
        />
      </Animated.View>
    </>
  );

  const shape = [styles.button, { width: size, height: size }];

  return (
    <Animated.View style={scaleStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, selected: active }}
        disabled={disabled}
        onPress={() => {
          tapped();
          onPress();
        }}
        {...handlers}
      >
        {surface === "glass" ? (
          <GlassSurface
            radius={radius}
            interactive
            tint={active ? colors.primaryGlass : undefined}
            fallback={active ? colors.primary : undefined}
            style={shape}
          >
            {body}
          </GlassSurface>
        ) : (
          <View
            style={[
              shape,
              {
                borderRadius: radius,
                backgroundColor: active ? colors.primary : colors.secondary,
              },
            ]}
          >
            {body}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    // Clips the press wash to the circle.
    overflow: "hidden",
  },
});
