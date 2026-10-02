import { useTwirl, WhirlRings } from "~/components/whirl-rings";

/**
 * The mini-site's mark: the whirl tinted brand blue, twirling into a rainbow
 * spin on hover. Same choreography as ~/components/whirl-logo, but tinted so
 * it stays blue in both themes instead of the black/inverted app mark.
 */
const RAINBOW_GRADIENT =
  "conic-gradient(from 0deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)";

const BRAND_BLUE = "#0C82F2";

export function AboutLogo({
  size = 36,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const { twirling, twirl } = useTwirl();
  const dim = `${size}px`;

  return (
    <span
      onMouseEnter={twirl}
      style={{ width: dim, height: dim }}
      className={`relative inline-block shrink-0 ${className}`}
    >
      <WhirlRings
        spin={twirling}
        layers={[
          { style: { backgroundColor: BRAND_BLUE } },
          {
            className: "transition-opacity duration-300",
            style: { backgroundImage: RAINBOW_GRADIENT, opacity: twirling ? 1 : 0 },
          },
        ]}
      />
    </span>
  );
}
