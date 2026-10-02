const STOPS =
  "#ff3b5c, #ff8a00, #ffd60a, #34d399, #22d3ee, #818cf8, #e879f9, #ff3b5c";

/**
 * Rotating conic-gradient halo: a blurred glow plus a crisp outline ring.
 * Absolutely positioned — parent must be `position: relative`, and the
 * glowed content must come after these siblings so it paints on top.
 */
export function RainbowGlow({
  angle,
  opacity,
  radius = 12,
}: {
  angle: number;
  opacity: number;
  /** Border radius of the content being wrapped, in px. */
  radius?: number;
}) {
  const gradient = `conic-gradient(from ${angle}deg, ${STOPS})`;
  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: -10,
          borderRadius: radius + 10,
          background: gradient,
          opacity: opacity * 0.75,
          filter: "blur(22px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: -3,
          borderRadius: radius + 3,
          background: gradient,
          opacity,
        }}
      />
    </>
  );
}
