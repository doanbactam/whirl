import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { IconSpy } from "@tabler/icons-react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { WhirlMark } from "@/components/whirl-mark";
import { SwapIcon } from "@/components/ui/swap-icon";
import { duration, ease, spring } from "@/lib/motion";
import { REPLACE_IN, REPLACE_OUT } from "@/lib/replace";
import { spacing, typography, useTheme } from "@/lib/theme";

const MARK_SIZE = 64;

/** Pinned rather than left to the font, so the line box can match it exactly. */
const GREETING_LINE = 36;

/** The words follow the mark in, once it's most of the way settled. */
const WORDS_DELAY = 140;

type GreetingPageProps = {
  name: string;
  /** Off the record: the page says so rather than leaving it to a toolbar. */
  incognito: boolean;
  /**
   * How far to sit above the middle of the page, so the block ends up in the
   * middle of what the composer and the keyboard leave visible.
   */
  lift: SharedValue<number>;
};

/** What an empty thread looks like: the mark, and who you are. */
export function GreetingPage({ name, incognito, lift }: GreetingPageProps) {
  const { colors } = useTheme();

  const settle = useSharedValue(0);
  const words = useSharedValue(0);

  useEffect(() => {
    settle.value = withSpring(1, spring.settle);
    words.value = withDelay(
      WORDS_DELAY,
      withTiming(1, { duration: duration.slow, easing: ease }),
    );
  }, [settle, words]);

  const markStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.8 + settle.value * 0.2 }],
  }));

  /* Alpha is fine here — the greeting shares no ancestor with a glass pane,
     the composer being docked over the screen rather than inside this page. */
  const wordsStyle = useAnimatedStyle(() => ({
    opacity: words.value,
    transform: [{ translateY: (1 - words.value) * 12 }],
  }));

  /* Transform, not padding: the composer's height and the keyboard's both
     change while you're looking at it, and shifting the block is smoother
     than relaying the page out under it every frame. */
  const centreStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -lift.value }],
  }));

  const greeting = incognito ? "Off the record" : `Hello ${name}`;

  return (
    <Animated.View style={[styles.page, centreStyle]}>
      {/* The mark's artwork is a touch taller than it is wide, so it sits in a
          square box and centres inside it rather than dragging the stack down.
          Going incognito replaces it the same way the toolbar button changes. */}
      <Animated.View style={[styles.markBox, markStyle]}>
        <SwapIcon
          icon={incognito ? IconSpy : WhirlMark}
          name={incognito ? "incognito" : "mark"}
          size={MARK_SIZE}
          color={colors.foreground}
        />
      </Animated.View>

      {/* A fixed line box: the outgoing greeting is still in the tree while
          the new one arrives, and in normal flow the two would stack and shove
          the mark upward mid-change. */}
      <Animated.View style={[styles.wordsBox, wordsStyle]}>
        <Animated.Text
          key={greeting}
          entering={REPLACE_IN}
          exiting={REPLACE_OUT}
          style={[typography.title, styles.words, { color: colors.foreground }]}
        >
          {greeting}
        </Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  markBox: {
    width: MARK_SIZE,
    height: MARK_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  wordsBox: {
    alignSelf: "stretch",
    height: GREETING_LINE,
  },
  words: {
    position: "absolute",
    left: 0,
    right: 0,
    lineHeight: GREETING_LINE,
    textAlign: "center",
  },
});
