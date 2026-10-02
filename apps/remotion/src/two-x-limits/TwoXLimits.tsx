import { loadFont } from "@remotion/google-fonts/Inter";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

import { RainbowGlow } from "./RainbowGlow";
import { BAR_COUNT, UserMenu } from "./UserMenu";

const { fontFamily } = loadFont("normal", {
  weights: ["500", "600"],
  subsets: ["latin"],
});

// 8s @ 60fps: a blink of 1x → boost to 2x → bask in it → settle back.
// The 2x moment is the star; the 1x bookends are just enough to sell the
// change. Boost starts and ends at 0 so the gif loops without a seam.
export const TWO_X_LIMITS_FPS = 60;
export const TWO_X_LIMITS_DURATION = 480;
const BOOST_KEYFRAMES = [24, 54, 426, 456];

// Fraction of the boost ramp each bar spends turning rainbow; the rest
// staggers the sweep left-to-right (and back right-to-left on the way down).
// Kept small so bars snap over instead of lingering in muddy mid-blend.
const BAR_SWEEP = 0.28;

export function TwoXLimits() {
  const frame = useCurrentFrame();

  const boost = interpolate(frame, BOOST_KEYFRAMES, [0, 1, 1, 0], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const barBoosts = Array.from({ length: BAR_COUNT }, (_, i) => {
    const start = (i / (BAR_COUNT - 1)) * (1 - BAR_SWEEP);
    return Math.min(1, Math.max(0, (boost - start) / BAR_SWEEP));
  });

  const percent = Math.round(100 + 100 * boost);
  // Both keep moving all loop long, but only show while boosted — so the
  // wrap-around jump in angle/hue is invisible.
  const glowAngle = frame * 1.2;
  const hueBase = (frame * 1.5) % 360;

  return (
    <AbsoluteFill
      className="items-center bg-white"
      style={{ fontFamily, paddingTop: 96 }}
    >
      <h1
        className="flex text-neutral-900"
        style={{
          fontSize: 62,
          fontWeight: 600,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          margin: 0,
        }}
      >
        <RollingDigit roll={boost} />
        <span style={{ lineHeight: 1 }}>x limits for the week</span>
      </h1>
      <p
        className="text-neutral-500"
        style={{ fontSize: 26, fontWeight: 500, margin: "22px 0 0" }}
      >
        Available on all paid plans
      </p>
      <div
        className="relative"
        style={{
          marginTop: 92,
          transform: "scale(1.9)",
          transformOrigin: "top center",
        }}
      >
        <RainbowGlow angle={glowAngle} opacity={boost} radius={12} />
        <div className="relative">
          <UserMenu percent={percent} barBoosts={barBoosts} hueBase={hueBase} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** The 1 slides up and the 2 rolls in, odometer style. */
function RollingDigit({ roll }: { roll: number }) {
  const shift = { display: "block", height: "1em", lineHeight: 1 } as const;
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        height: "1em",
        overflow: "hidden",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span style={{ ...shift, transform: `translateY(${-roll * 100}%)` }}>
        1
      </span>
      <span style={{ ...shift, transform: `translateY(${-roll * 100}%)` }}>
        2
      </span>
    </span>
  );
}
