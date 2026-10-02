"use client";

import { useTwirl, WhirlHoverMark } from "@/components/whirl-rings";

export function MarketingLogo({
  size = 36,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const { twirling, twirl } = useTwirl();
  return (
    <span
      onMouseEnter={twirl}
      style={{ width: size, height: size }}
      className={`relative inline-block shrink-0 ${className}`}
    >
      <WhirlHoverMark
        twirling={twirling}
        layers={[{ style: { backgroundColor: "#0c82f2" } }]}
      />
    </span>
  );
}
