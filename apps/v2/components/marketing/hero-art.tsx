import { PlasmaWave } from "@/components/marketing/plasma-wave";

export function HeroArt() {
  return (
    <div className="relative mt-8 aspect-[5/2] overflow-hidden rounded-3xl bg-neutral-950 ring-1 ring-black/7 sm:aspect-[4/1] dark:ring-white/8">
      <PlasmaWave className="absolute inset-0" />
      {/* Animated SVGs are served directly so their internal petal timing
          remains intact; the 4:3 scale cancels the asset's safety padding. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/whirl-animate.svg"
        alt="Whirl"
        width={240}
        height={242}
        className="pointer-events-none absolute top-1/2 left-1/2 h-auto w-16 -translate-x-1/2 -translate-y-1/2 scale-[1.3333] invert sm:w-24"
      />
    </div>
  );
}
