import { useRef, type ElementType } from "react";
import {
  SmoothCorners,
  useSmoothCorners,
  type SmoothCornersProps,
} from "@lisse/react";

/**
 * App-wide corner smoothing (Figma's default). One knob so every squircle in
 * the app bends the same way.
 */
export const SQUIRCLE_SMOOTHING = 0.6;

type PerCornerRadius = {
  topLeft?: number;
  topRight?: number;
  bottomRight?: number;
  bottomLeft?: number;
};

type SquircleProps<E extends ElementType = "div"> = Omit<
  SmoothCornersProps<E>,
  "corners"
> & {
  /**
   * Corner radius in px — match the rounded-* class you'd otherwise reach
   * for. Pass a per-corner object for mixed radii (e.g. a chat bubble tail).
   */
  radius: number | PerCornerRadius;
  /** Override the app-default smoothing (0..1). */
  smoothing?: number;
};

/**
 * A Lisse-clipped surface: renders its content with genuinely smooth
 * (Figma-style squircle) corners instead of CSS border-radius arcs.
 *
 * Usage notes:
 * - Keep the matching `rounded-*` class on `className` — it's the SSR /
 *   pre-hydration fallback; the clip-path takes over on mount.
 * - CSS borders and box-shadows on the element are auto-lifted into SVG
 *   overlays that hug the squircle, so shell classes work unchanged.
 * - Lisse mounts a plain `position: relative` wrapper div around the clipped
 *   element. Put positioning/animation on an ancestor you own (e.g. the
 *   motion.div doing the entrance), and give Squircle only the visual +
 *   internal-layout classes.
 * - Don't clip surfaces that hang children outside their bounds (nested
 *   flyout menus, tooltips) — the clip-path would eat them.
 */
export function Squircle<E extends ElementType = "div">({
  radius,
  smoothing = SQUIRCLE_SMOOTHING,
  ...rest
}: SquircleProps<E>) {
  const corners =
    typeof radius === "number"
      ? { radius, smoothing }
      : {
          topLeft: { radius: radius.topLeft ?? 0, smoothing },
          topRight: { radius: radius.topRight ?? 0, smoothing },
          bottomRight: { radius: radius.bottomRight ?? 0, smoothing },
          bottomLeft: { radius: radius.bottomLeft ?? 0, smoothing },
        };
  return (
    <SmoothCorners
      corners={corners}
      {...(rest as unknown as SmoothCornersProps<E>)}
    />
  );
}

/**
 * A squircle-clipped background layer for surfaces that can't be clipped
 * themselves — anything that hangs popovers, pills, or tooltips outside its
 * bounds (clipping the surface would eat them). Renders as an absolutely
 * positioned underlay filling the nearest positioned ancestor; put the
 * surface's visual classes (background, border, shadow, rounded-* fallback)
 * on `className` and give the host element `relative isolate` so the underlay
 * sits above the host background but under all content.
 */
export function SquircleUnderlay({
  radius,
  smoothing = SQUIRCLE_SMOOTHING,
  className,
}: {
  radius: number;
  smoothing?: number;
  className?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  useSmoothCorners(surfaceRef, { radius, smoothing }, { wrapperRef });
  return (
    <div
      ref={wrapperRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-[1]"
    >
      <div ref={surfaceRef} className={`h-full w-full ${className ?? ""}`} />
    </div>
  );
}
