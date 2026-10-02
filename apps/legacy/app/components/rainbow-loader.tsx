import { RAINBOW_LAYER, WhirlRings } from "~/components/whirl-rings";

/**
 * The rainbow Whirl rings spinning as a full-page loading indicator on the
 * public share and visual pages. Center it with a flex wrapper at the call site.
 */
export function RainbowLoader({ size = 36 }: { size?: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <WhirlRings spin layers={[RAINBOW_LAYER]} />
    </div>
  );
}
