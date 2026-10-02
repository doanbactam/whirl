import { useTwirl, WhirlRings } from "~/components/whirl-rings";

const RAINBOW_GRADIENT =
  "conic-gradient(from 0deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)";

export function WhirlLogo({
  size = 20,
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
          { className: "bg-black dark:bg-white" },
          {
            className: "transition-opacity duration-300",
            style: { backgroundImage: RAINBOW_GRADIENT, opacity: twirling ? 1 : 0 },
          },
        ]}
      />
    </span>
  );
}
