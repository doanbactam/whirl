import { useState, type ReactElement } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";

import { duration } from "@/lib/motion";
import type { MenuAction } from "@/lib/menu";
import { radius, spacing, typography, useTheme } from "@/lib/theme";

type ContextMenuProps = {
  actions: MenuAction[];
  /** Matches the iOS host's contract, where SwiftUI has to be told the size. */
  height: number;
  children: ReactElement;
};

/**
 * The long-press menu on everything that isn't iOS.
 *
 * iOS gets the real system menu (see context-menu.ios.tsx); there's no
 * equivalent to borrow here, so the app draws one — a sheet from the bottom,
 * which is where a phone's thumb already is, rather than a popover pinned to a
 * row that may be anywhere on screen.
 */
export function ContextMenu({ actions, height, children }: ContextMenuProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  const pick = (action: MenuAction) => {
    setOpen(false);
    action.onPress();
  };

  return (
    <View style={{ height }}>
      <Pressable
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
            () => {},
          );
          setOpen(true);
        }}
        delayLongPress={280}
        style={styles.fill}
      >
        {children}
      </Pressable>

      {/* A `Modal` rather than an overlay: the row lives inside a scrolling
          list that clips its children, so anything drawn in place would be
          trapped in one row's worth of screen. */}
      <Modal
        visible={open}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <Animated.View
          entering={FadeIn.duration(duration.fast)}
          exiting={FadeOut.duration(duration.fast)}
          style={styles.fill}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            onPress={() => setOpen(false)}
            style={[styles.scrim, { backgroundColor: colors.scrim }]}
          />

          <Animated.View
            entering={FadeInDown.duration(duration.base)}
            style={styles.dock}
          >
            <View
              style={[
                styles.sheet,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              {actions.map((action, index) => {
                const Icon = action.icon;
                const ink = action.destructive
                  ? colors.danger
                  : colors.foreground;

                return (
                  <Pressable
                    key={action.key}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: action.disabled }}
                    disabled={action.disabled}
                    onPress={() => pick(action)}
                    style={({ pressed }) => [
                      styles.item,
                      index > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.border,
                      },
                      pressed && { backgroundColor: colors.secondaryPressed },
                      action.disabled && styles.disabled,
                    ]}
                  >
                    {Icon ? <Icon size={20} color={ink} /> : null}
                    <Text style={[typography.body, { color: ink }]}>
                      {action.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  dock: {
    marginTop: "auto",
    padding: spacing.lg,
  },
  sheet: {
    borderRadius: radius.panel,
    borderWidth: StyleSheet.hairlineWidth,
    // Keeps the press wash inside the panel's corners.
    overflow: "hidden",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  disabled: {
    opacity: 0.45,
  },
});
