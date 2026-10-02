"use client";

import { useEffect, useState, type ComponentType, type CSSProperties } from "react";
import {
  IconBrandGithubFilled,
  IconCode,
  IconGitFork,
  IconGitPullRequest,
  IconStarFilled,
} from "@tabler/icons-react";
import { motion } from "motion/react";

import { WhirlRings } from "@/components/whirl-rings";
import { EASE_OUT, pinRasterPath } from "@/lib/motion";

/* The open-source announcement's hero: the Whirl mark as a small sun, with
   the things a public repo brings drifting around it on two dotted orbits.
   The orbits counter-rotate, the same way the mark's own two rings do.

   All of the drift is CSS (`.oss-orbit` in globals.css), so it runs on the
   compositor and ends when the modal unmounts. Every satellite counter-spins
   at its orbit's pace so its label stays upright the whole way round. */

type Icon = ComponentType<{ size?: number; stroke?: number; className?: string }>;

type Satellite = { angle: number } & (
  | { icon: Icon; label?: never }
  | { label: string; icon?: never }
);

type Orbit = {
  radius: number;
  seconds: number;
  reverse?: boolean;
  satellites: Satellite[];
};

/* Angles are degrees clockwise from three o'clock. The outer orbit is wider
   than the band is tall, so its satellites slip out past the top and bottom
   edges and drift back in later.

   The rings turn against each other, so every inner chip eventually lines
   up with every outer one. The tightest pass is horizontal: the widest
   label's half-width (~49px) plus a chip's radius (16px) has to fit inside
   the 70px between the rings. Same for the planet: its 40px radius plus a
   chip's 16px sits inside the inner ring's 62px. */
const ORBITS: Orbit[] = [
  {
    radius: 62,
    seconds: 46,
    satellites: [
      { angle: -35, icon: IconBrandGithubFilled },
      { angle: 85, icon: IconStarFilled },
      { angle: 205, icon: IconGitFork },
    ],
  },
  {
    radius: 132,
    seconds: 72,
    reverse: true,
    satellites: [
      { angle: 8, label: "MIT license" },
      { angle: 95, label: "PRs welcome" },
      { angle: 172, label: "Self-hostable" },
      { angle: 210, icon: IconGitPullRequest },
      { angle: 330, icon: IconCode },
    ],
  },
];

/* Theme tokens lose their alpha behind Tailwind's `/NN` modifier (it
   compiles solid), so the faint inks are mixed by hand. */
const DOT_INK = "color-mix(in oklch, var(--foreground) 9%, transparent)";
const ORBIT_INK = "color-mix(in oklch, var(--foreground) 22%, transparent)";

/* One breath of the mark as the modal lands, timed to the rings' spin. */
const INTRO_SPIN_MS = 1900;

export function OpenSourceHero() {
  const [introSpin, setIntroSpin] = useState(true);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIntroSpin(false), INTRO_SPIN_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      aria-hidden
      className="relative h-48 overflow-hidden border-b border-border bg-well"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
        transformTemplate={pinRasterPath}
        className="absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_55%,transparent_90%)]"
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(${DOT_INK} 1px, transparent 1.5px)`,
            backgroundSize: "14px 14px",
            backgroundPosition: "center",
          }}
        />
        {ORBITS.map((orbit, orbitIndex) => (
          <OrbitRing
            key={orbit.radius}
            orbit={orbit}
            delay={0.18 + orbitIndex * 0.12}
          />
        ))}
      </motion.div>

      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 22, delay: 0.06 }}
          transformTemplate={pinRasterPath}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          className="flex size-20 items-center justify-center rounded-full bg-popover ring-1 ring-border"
        >
          <span className="relative size-10">
            <WhirlRings
              spin={introSpin || hovered}
              breathe
              layers={[{ className: "bg-foreground" }]}
            />
          </span>
        </motion.div>
      </div>
    </div>
  );
}

function OrbitRing({ orbit, delay }: { orbit: Orbit; delay: number }) {
  const { radius, seconds, reverse, satellites } = orbit;
  const size = radius * 2;

  /* The ring turns one way; each satellite turns back the other way at the
     same pace, which is what keeps it upright. */
  const spin = (backwards: boolean): CSSProperties => ({
    animationDuration: `${seconds}s`,
    animationDirection: backwards ? "reverse" : "normal",
  });

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        className="oss-orbit relative shrink-0"
        style={{ width: size, height: size, ...spin(Boolean(reverse)) }}
      >
        <svg
          className="absolute inset-0 overflow-visible"
          viewBox={`0 0 ${size} ${size}`}
          fill="none"
        >
          <circle
            cx={radius}
            cy={radius}
            r={radius}
            stroke={ORBIT_INK}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray="0 7"
          />
        </svg>
        {satellites.map((satellite, index) => {
          const radians = (satellite.angle * Math.PI) / 180;
          return (
            /* A zero-size anchor on the ring; flex centers the satellite on
               it without a transform, leaving `rotate` free for the spin. */
            <span
              key={satellite.angle}
              className="absolute flex size-0 items-center justify-center"
              style={{
                left: radius + radius * Math.cos(radians),
                top: radius + radius * Math.sin(radians),
              }}
            >
              <motion.span
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 420,
                  damping: 24,
                  delay: delay + index * 0.05,
                }}
                transformTemplate={pinRasterPath}
                className="flex shrink-0"
              >
                <span className="oss-orbit flex" style={spin(!reverse)}>
                  <SatelliteChip satellite={satellite} />
                </span>
              </motion.span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function SatelliteChip({ satellite }: { satellite: Satellite }) {
  if (satellite.label) {
    return (
      <span className="flex h-7 items-center rounded-full bg-popover px-2.5 text-[11.5px]/4 font-medium whitespace-nowrap text-foreground-soft ring-1 ring-border">
        {satellite.label}
      </span>
    );
  }

  const Icon = satellite.icon as Icon;
  return (
    <span className="flex size-8 items-center justify-center rounded-full bg-popover text-foreground-soft ring-1 ring-border">
      <Icon size={15} />
    </span>
  );
}
