import { useEffect, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { WhirlMark } from "@/components/whirl-mark";
import { FormError } from "@/components/ui/form-error";
import { Screen } from "@/components/ui/screen";
import { Stagger } from "@/components/ui/stagger";
import { duration, ease, spring } from "@/lib/motion";
import { spacing, typography, useTheme } from "@/lib/theme";

/* The screen arrives in two beats: the mark, then the words. The form itself
   holds still — see the note on it below. */
const WORDS_DELAY = 120;
const FOOTER_DELAY = 420;

type AuthScreenProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  /**
   * A form-level problem, shown above the fields. It lives here rather than
   * among the children because it comes and goes — and a staggered child that
   * renders nothing still holds a gap open where it would have been.
   */
  error?: string | null;
  /** Sits under the form — usually the link across to the other screen. */
  footer?: ReactNode;
  /**
   * Change this when the screen swaps its content in place — sign up moving
   * to its verification step — and the words and form play their entrance
   * again. The mark holds still through it, so the swap reads as one screen
   * changing its mind rather than a whole new screen.
   */
  stepKey?: string;
};

/** Shared furniture for sign in, sign up, and the verification step. */
export function AuthScreen({
  title,
  subtitle,
  children,
  error,
  footer,
  stepKey,
}: AuthScreenProps) {
  const { colors } = useTheme();

  return (
    <Screen scrollable centered>
      <View style={styles.header}>
        <MarkEntrance>
          <WhirlMark size={44} color={colors.foreground} />
        </MarkEntrance>

        <Stagger key={`words:${stepKey}`} delay={WORDS_DELAY} style={styles.words}>
          <Text style={[typography.title, { color: colors.foreground }]}>
            {title}
          </Text>
          <Text
            style={[
              typography.subtitle,
              styles.subtitle,
              { color: colors.foregroundSoft },
            ]}
          >
            {subtitle}
          </Text>
        </Stagger>
      </View>

      {/* Wrapped rather than left to render null in place, so the spacing
          below it disappears along with the banner. */}
      {error ? (
        <View style={styles.alert}>
          <FormError message={error} />
        </View>
      ) : null}

      {/* Not staggered, and deliberately so. A staggered child starts at
          opacity 0, and a glass pane created under a transparent ancestor
          can come up empty — with nothing on the native side to retry it,
          the fields and buttons would stay clear. The words above carry the
          entrance; the form arrives with them. */}
      <View style={styles.body}>{children}</View>

      {footer ? (
        <Animated.View
          entering={FadeIn.delay(FOOTER_DELAY).duration(duration.slow)}
          style={styles.footer}
        >
          {footer}
        </Animated.View>
      ) : null}
    </Screen>
  );
}

/** The mark settles in once, on arrival. It does not rotate — it's a logo. */
function MarkEntrance({ children }: { children: ReactNode }) {
  const settle = useSharedValue(0);
  const fade = useSharedValue(0);

  useEffect(() => {
    settle.value = withSpring(1, spring.settle);
    /* Opacity gets its own timing: the spring's overshoot gives the shape
       weight, but on a fade it just reads as a flicker. */
    fade.value = withTiming(1, { duration: duration.slow, easing: ease });
  }, [fade, settle]);

  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ scale: 0.88 + settle.value * 0.12 }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    gap: spacing.lg,
    marginBottom: spacing.xxl,
  },
  words: {
    alignItems: "center",
    gap: spacing.sm,
  },
  subtitle: {
    textAlign: "center",
  },
  alert: {
    marginBottom: spacing.lg,
  },
  body: {
    gap: spacing.lg,
  },
  footer: {
    marginTop: spacing.xl,
  },
});
