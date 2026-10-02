import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/** Starter composition: the wordmark twirls in, because of course it does. */
export function HelloWhirl() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const settle = spring({ frame, fps, config: { damping: 14, mass: 0.8 } });
  const rotate = interpolate(settle, [0, 1], [-360, 0]);
  const scale = interpolate(settle, [0, 1], [0.4, 1]);
  const fade = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#111",
        fontFamily:
          "'Inter', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <h1
        style={{
          color: "#fafafa",
          fontSize: 160,
          fontWeight: 650,
          letterSpacing: "-0.04em",
          margin: 0,
          opacity: fade,
          transform: `rotate(${rotate}deg) scale(${scale})`,
        }}
      >
        whirl
      </h1>
    </AbsoluteFill>
  );
}
