import { useEffect } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { IconGitBranch, IconPinFilled } from "@tabler/icons-react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { ContextMenu } from "@/components/ui/context-menu";
import { duration } from "@/lib/motion";
import { usePress } from "@/lib/press";
import type { MenuAction } from "@/lib/menu";
import type { ThreadSummary } from "@/lib/threads";
import { radius, spacing, typography, useTheme } from "@/lib/theme";

/**
 * Fixed, and exported, because the list is virtualised off it and the iOS
 * menu host has to be told how tall the row it's wrapping is.
 */
export const ROW_HEIGHT = 48;

type ThreadRowProps = {
  thread: ThreadSummary;
  active: boolean;
  actions: MenuAction[];
  onPress: () => void;
};

/**
 * One conversation in the list: its name, and a quiet mark for anything worth
 * knowing before you open it.
 *
 * Titles run to a single line and truncate. A thread's name is a label, not a
 * summary — two-line rows would halve how many fit on screen to show the tail
 * end of a sentence nobody reads.
 */
export function ThreadRow({ thread, active, actions, onPress }: ThreadRowProps) {
  const { colors } = useTheme();
  const { handlers, scaleStyle, tapped } = usePress({ scaleTo: 0.985 });

  const pinned = thread.pinnedAt !== null;
  const generating = thread.titleStatus === "generating";

  return (
    <ContextMenu actions={actions} height={ROW_HEIGHT}>
      <Animated.View style={[styles.row, scaleStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={thread.title}
          accessibilityState={{ selected: active }}
          onPress={() => {
            tapped();
            onPress();
          }}
          {...handlers}
          style={[
            styles.press,
            active && {
              backgroundColor: colors.surface,
              borderRadius: radius.controlSmall,
            },
          ]}
        >
          {thread.branchedFromThreadId ? (
            <IconGitBranch size={14} color={colors.foregroundMuted} />
          ) : null}

          <ThreadTitle title={thread.title} generating={generating} />

          {/* One glyph at most, and a running turn outranks a pin — a thread
              you're waiting on is the more urgent fact about it. */}
          {thread.running ? (
            <ActivityIndicator size="small" color={colors.foregroundMuted} />
          ) : pinned ? (
            <IconPinFilled
              size={13}
              color={colors.foregroundMuted}
              style={styles.pin}
            />
          ) : null}
        </Pressable>
      </Animated.View>
    </ContextMenu>
  );
}

/**
 * The name, breathing gently while a model is picking a better one.
 *
 * Same idea as the web app's shimmer, minus the gradient sweep: a mask
 * animation per row is real work on a phone, and a slow pulse says "this is
 * about to change" just as well.
 */
function ThreadTitle({
  title,
  generating,
}: {
  title: string;
  generating: boolean;
}) {
  const { colors } = useTheme();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (!generating) {
      pulse.value = withTiming(1, { duration: duration.fast });
      return;
    }
    pulse.value = withRepeat(
      withTiming(0.4, {
        duration: 900,
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      true,
    );
  }, [generating, pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={[styles.titleBox, style]}>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[styles.title, { color: colors.foreground }]}
      >
        {title}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  press: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: ROW_HEIGHT - spacing.xs,
    paddingHorizontal: spacing.md,
  },
  titleBox: {
    flex: 1,
  },
  title: {
    ...typography.body,
    // Even line height, so the glyphs never land on a half pixel.
    lineHeight: 22,
  },
  pin: {
    // Pins read as pins at a slight angle; upright they read as a tack.
    transform: [{ rotate: "45deg" }],
  },
});
