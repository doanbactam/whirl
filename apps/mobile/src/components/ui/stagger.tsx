import { Children, isValidElement, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { duration, STAGGER_STEP } from "@/lib/motion";

type StaggerProps = {
  children: ReactNode;
  /** Held before the first child moves — lets a header land ahead of a form. */
  delay?: number;
  /** Gap between siblings. */
  step?: number;
  /** How far each child rises into place. */
  distance?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Brings its children in one after another instead of all at once, which is
 * the difference between a screen that appears and a screen that arrives.
 *
 * Every child gets a wrapper view to animate, which means a child that renders
 * nothing still occupies a slot — and under `gap`, a slot is a gap. Anything
 * that comes and goes belongs outside the sequence rather than in it.
 */
export function Stagger({
  children,
  delay = 0,
  step = STAGGER_STEP,
  distance = 14,
  style,
}: StaggerProps) {
  return (
    <Animated.View style={style}>
      {Children.toArray(children)
        .filter(isValidElement)
        .map((child, index) => (
          <Animated.View
            key={child.key ?? index}
            entering={FadeInDown.delay(delay + index * step)
              .duration(duration.slow)
              .withInitialValues({ transform: [{ translateY: distance }] })}
          >
            {child}
          </Animated.View>
        ))}
    </Animated.View>
  );
}
