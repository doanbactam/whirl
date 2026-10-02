import {
  useCallback,
  useEffect,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { AppState, StyleSheet, View } from "react-native";
import { GlassView, type GlassViewProps } from "expo-glass-effect";
import Animated from "react-native-reanimated";

import { HAS_GLASS } from "@/lib/glass";
import { useTheme } from "@/lib/theme";

/**
 * `borderRadius` is a *native prop* on the glass view, not a style — it feeds
 * the effect's own `cornerConfiguration`. Passing it through `style` rounds
 * the host layer and leaves the glass itself square, so it has to be handed
 * over directly. The prop isn't in the published types, hence the widening.
 */
const NativeGlassView = GlassView as ComponentType<
  GlassViewProps & { borderRadius?: number }
>;

type GlassSurfaceProps = {
  children?: ReactNode;
  /** Corner radius, applied to the effect itself rather than a clipping mask. */
  radius: number;
  /** Colours the pane. Defaults to the neutral tint. */
  tint?: string;
  /** Fill used when real glass isn't available. Defaults to the neutral one. */
  fallback?: string;
  /**
   * Turns on the material's own touch response — the flex and shine a glass
   * control gives under a finger. For panes that *are* controls; a bar that
   * merely holds them shouldn't react to being brushed.
   */
  interactive?: boolean;
  /**
   * Whether the pane wants a lit edge. Only ever drawn on the fallback — real
   * glass renders its own specular rim, and a hairline on top of it reads as
   * a border stuck to the material rather than part of it.
   */
  rim?: boolean;
  /** Animated styles are welcome — the container is an `Animated.View`. */
  style?: ComponentProps<typeof Animated.View>["style"];
};

/**
 * A pane of glass with something on it.
 *
 * The glass sits in its own absolutely-positioned layer behind the children
 * rather than wrapping them, for two reasons: the native view can then be
 * swapped for a solid fallback without disturbing the layout, and it can be
 * held out of the touch path entirely so it never competes with a `Pressable`
 * above it for the responder.
 *
 * Always `regular`. `clear` is built for glass floating over photography or
 * video — over a plain background it renders as very nearly nothing.
 */
export function GlassSurface({
  children,
  radius,
  tint,
  fallback,
  rim = true,
  interactive = false,
  style,
}: GlassSurfaceProps) {
  const { colors, scheme } = useTheme();

  return (
    <Animated.View style={[{ borderRadius: radius }, style]}>
      {HAS_GLASS ? (
        <GlassPane
          radius={radius}
          tint={tint ?? colors.glassTint}
          scheme={scheme}
          interactive={interactive}
        />
      ) : (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            rim && styles.rim,
            {
              borderRadius: radius,
              backgroundColor: fallback ?? colors.glassFill,
              borderColor: colors.glassRim,
            },
          ]}
        />
      )}

      {children}
    </Animated.View>
  );
}

type GlassPaneProps = {
  radius: number;
  tint: string;
  scheme: "light" | "dark";
  interactive: boolean;
};

/**
 * The native pane, switched on only once it has a frame.
 *
 * The effect is applied natively on *change* of the style prop, and the change
 * is dropped if the view hasn't been laid out yet. So a mount that loses that
 * race isn't just late — nothing retries it, and the pane stays clear for the
 * life of the view. Mounting with no effect and turning it on from `onLayout`
 * makes the hand-off deterministic: by the time the layout event reaches us
 * the native view has its frame, so the switch always takes.
 */
function GlassPane(props: GlassPaneProps) {
  /* Remounting on resume replays that hand-off. The native side has no way to
     re-assert an effect it lost while the app was away, so this is the only
     lever we have — and a fresh view is cheaper than a pane that never returns. */
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setGeneration((n) => n + 1);
    });
    return () => subscription.remove();
  }, []);

  return <Pane key={generation} {...props} />;
}

function Pane({ radius, tint, scheme, interactive }: GlassPaneProps) {
  const [laidOut, setLaidOut] = useState(false);
  // Idempotent: React drops the re-render once this has already flipped.
  const handleLayout = useCallback(() => setLaidOut(true), []);

  return (
    <NativeGlassView
      /* An interactive pane has to be able to *see* the touch to answer it,
         so it can't be held out of the hit path. It carries no handlers of
         its own, so the `Pressable` above it still wins the responder —
         in React Native only a view with its own handlers takes one. */
      pointerEvents={interactive ? "auto" : "none"}
      style={StyleSheet.absoluteFill}
      borderRadius={radius}
      glassEffectStyle={laidOut ? "regular" : "none"}
      isInteractive={interactive}
      tintColor={tint}
      /* The app themes itself off `useColorScheme`, so the glass has to be
         told the same thing rather than reading the system on its own. */
      colorScheme={scheme}
      onLayout={handleLayout}
    />
  );
}

const styles = StyleSheet.create({
  rim: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
