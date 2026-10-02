import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
} from "motion/react";

import { pinRasterPath } from "~/lib/motion";

/* The classic swirl has no separable inner ring, so the whole mark rides
   in the outer mask and the inner mask is empty — a spin turns the mark
   as one piece, clockwise. Rotation is driven from here (not baked into
   an svg) so a spin always starts from — and lands on — the rest pose,
   staying perfectly in sync with the static mark. */
const OUTER_MASK: CSSProperties = maskStyle("/whirl-ring-outer.svg");
const INNER_MASK: CSSProperties = maskStyle("/whirl-ring-inner.svg");

/* The breathing rhythm: one full eased revolution, a beat of stillness at
   the rest pose, then again. */
const SPIN_SECONDS = 1.8;
const SPIN_PAUSE_SECONDS = 0.1;
const SPIN_EASE = [0.65, 0, 0.35, 1] as const;

/* How far the mark shrinks mid-turn when `breathe` is on: it inhales down
   while spinning and swells back to full size for the rest pose. */
const BREATHE_DEPTH = 0.15;

/* Pose continuity across remounts. The chat feed replaces the live streaming
   bubble with a freshly mounted completed bubble (the "handoff"), which would
   reset a mid-turn ring to the rest pose in a single frame — a visible size
   and angle snap. Instances with a `continuityId` park their pose here on
   unmount; a replacement mounting shortly after resumes from it and winds
   down smoothly. The TTL keeps unrelated mounts (e.g. opening an old thread)
   from inheriting a stale pose. */
const parkedPoses = new Map<string, { pose: number; at: number }>();
const PARKED_POSE_TTL_MS = 1000;

function resumePose(id: string | undefined) {
  if (!id) return 0;
  const parked = parkedPoses.get(id);
  if (!parked || performance.now() - parked.at > PARKED_POSE_TTL_MS) return 0;
  return parked.pose;
}

function maskStyle(url: string): CSSProperties {
  return {
    WebkitMaskImage: `url(${url})`,
    maskImage: `url(${url})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  };
}

export type RingLayer = {
  className?: string;
  style?: CSSProperties;
};

/** The sliding-rainbow fill used by the app's loading indicators. */
export const RAINBOW_LAYER: RingLayer = {
  className:
    "animate-rainbow bg-[linear-gradient(90deg,#ff2e93,#ff7a00,#ffd400,#00d36e,#00b7ff,#7a5cff,#ff2e93)] bg-[length:200%_100%]",
};

// One full eased revolution (1.8s) plus a hair — the spin flips off inside
// the breathing pause, when the rings are already back at the rest pose.
export const TWIRL_MS = 1850;

/** Hover-twirl state: one breath cycle per trigger, with a short cooldown. */
export function useTwirl() {
  const [twirling, setTwirling] = useState(false);
  const busyRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => timersRef.current.forEach((t) => clearTimeout(t)),
    [],
  );

  const twirl = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setTwirling(true);
    timersRef.current = [
      setTimeout(() => setTwirling(false), TWIRL_MS),
      setTimeout(() => {
        busyRef.current = false;
      }, TWIRL_MS + 400),
    ];
  };

  return { twirling, twirl };
}

/**
 * The Whirl mark as two counter-rotating rings, colored by masked `layers`
 * (stack several to crossfade fills). While `spin` is true the rings breathe:
 * an eased full turn, a brief rest, repeat. When it flips off they ease
 * forward to the next full turn so they always land exactly on the static
 * pose. Only the masks rotate — fills are counter-rotated back so both rings
 * always show identical, screen-fixed color.
 *
 * `breathe` is STATIC config — a component either breathes or it doesn't.
 * It must never be toggled at runtime: scale is a pure function of rotation,
 * and gating it on a boolean would snap the size in a single frame when the
 * boolean flips mid-turn. Because it derives from rotation alone, the size
 * can only change as smoothly as the rotation itself, and both arrive at the
 * rest pose together — including through the wind-down.
 */
export function WhirlRings({
  spin = false,
  breathe = false,
  layers,
  className = "",
  continuityId,
}: {
  spin?: boolean;
  breathe?: boolean;
  layers: RingLayer[];
  className?: string;
  /** Resume the pose of a same-id instance unmounted moments ago. */
  continuityId?: string;
}) {
  const [initialPose] = useState(() => resumePose(continuityId));
  const rotation = useMotionValue(initialPose);
  const counterRotation = useTransform(rotation, (r) => -r);
  const scale = useTransform(rotation, (r) =>
    breathe
      ? 1 - BREATHE_DEPTH * Math.sin(Math.PI * ((((r % 360) + 360) % 360) / 360))
      : 1,
  );

  useEffect(() => {
    if (!continuityId) return;
    return () => {
      parkedPoses.set(continuityId, {
        pose: rotation.get(),
        at: performance.now(),
      });
    };
  }, [continuityId, rotation]);

  useEffect(() => {
    if (spin) {
      const from = rotation.get();
      const controls = animate(rotation, [from, from + 360], {
        duration: SPIN_SECONDS,
        ease: SPIN_EASE,
        repeat: Infinity,
        repeatDelay: SPIN_PAUSE_SECONDS,
      });
      return () => controls.stop();
    }

    const current = rotation.get();
    const rest = Math.ceil(current / 360) * 360;
    if (rest === current) {
      rotation.set(0);
      return;
    }
    const controls = animate(rotation, rest, {
      duration: 0.25 + ((rest - current) / 360) * 0.5,
      ease: "easeOut",
      onComplete: () => rotation.set(0),
    });
    return () => controls.stop();
  }, [spin, rotation]);

  /* Mask and fill live on separate elements: the mask rotates, the fill
     inside counter-rotates to stay screen-fixed (oversized so its corners
     never leave the masked area mid-turn). willChange: "auto" opts out of
     motion's automatic will-change management, and pinRasterPath keeps the
     transform non-identity, so the rendering path (and with it,
     rasterization) is identical spinning and at rest. */
  const ring = (
    mask: CSSProperties,
    rotate: MotionValue<number>,
    counter: MotionValue<number>,
  ) => (
    <motion.span
      className="absolute inset-0"
      style={{ ...mask, rotate, willChange: "auto" }}
      transformTemplate={pinRasterPath}
    >
      <motion.span
        className="absolute -inset-1/4"
        style={{ rotate: counter, willChange: "auto" }}
        transformTemplate={pinRasterPath}
      >
        {layers.map((layer, i) => (
          <span
            key={i}
            className={`absolute inset-0 ${layer.className ?? ""}`}
            style={layer.style}
          />
        ))}
      </motion.span>
    </motion.span>
  );

  return (
    <motion.span
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{ scale, willChange: "auto" }}
      transformTemplate={pinRasterPath}
    >
      {ring(OUTER_MASK, rotation, counterRotation)}
      {ring(INNER_MASK, counterRotation, rotation)}
    </motion.span>
  );
}
