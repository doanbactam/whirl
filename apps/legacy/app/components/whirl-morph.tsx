import { RAINBOW_LAYER, useTwirl, WhirlRings } from "~/components/whirl-rings";

/**
 * Assistant avatar. While text is generating the rings breathe in rainbow —
 * inhaling smaller through each turn, swelling back to full size for the
 * rest between turns — then wind down to the rest pose and fade back to the
 * static mark. Hovering the idle avatar plays one twirl, like WhirlLogo.
 *
 * One WhirlRings instance carries both fills as crossfading layers, so the
 * static and spinning states share the exact same geometry — there is no
 * second copy at a different size to mismatch against. `breathe` stays on
 * permanently (it's static config): scale follows rotation, so at rest it
 * is exactly 1 and toggling it would only ever snap the size mid-turn.
 */
export function WhirlMorph({
  busy,
  size = 20,
  continuityId,
}: {
  busy: boolean;
  size?: number;
  /** Resume ring pose across a remount (see WhirlRings). */
  continuityId?: string;
}) {
  const { twirling, twirl } = useTwirl();
  const lively = busy || twirling;

  return (
    <span
      onMouseEnter={() => {
        if (!busy) twirl();
      }}
      className="relative inline-block shrink-0"
      style={{ width: size, height: size }}
    >
      <WhirlRings
        spin={lively}
        breathe
        continuityId={continuityId}
        layers={[
          {
            className: "bg-black transition-opacity duration-300 dark:bg-white",
            style: { opacity: lively ? 0 : 1 },
          },
          {
            className: `${RAINBOW_LAYER.className} transition-opacity duration-300`,
            style: { opacity: lively ? 1 : 0 },
          },
        ]}
      />
    </span>
  );
}
