import { useEffect, useState } from "react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheckFilled,
  IconDownload,
} from "@tabler/icons-react";
import { motion } from "motion/react";

import { FadeInImage } from "~/components/fade-in-image";
import {
  IntegrationLogo,
  VerifiedBadge,
} from "~/components/integrations/integration-logo";
import { useDominantColor } from "~/lib/dominant-color";

// The hero of a store tab: one listing at a time on a full-bleed backdrop —
// its banner when the developer uploaded one, otherwise the dominant color
// sampled from its logo. Swipe, arrows, or dots to move; it also drifts
// along on its own until the pointer hovers it. Listing-type-agnostic: the
// browse tab feeds it integrations, the skills tab feeds it skills.

const ADVANCE_MS = 6000;

const slideSpring = { type: "spring" as const, stiffness: 300, damping: 34 };

/** One slide, whatever kind of listing it is. Callers map their store types
 * into this shape (including the CTA wording and the description fallback). */
export type FeaturedSlideData = {
  id: string;
  name: string;
  description: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  iconSvg?: string;
  verified: boolean;
  /** True disables the CTA and swaps in the "Installed" check. */
  installed: boolean;
  /** CTA label while not installed ("Install", "Finish setup", …). */
  cta: string;
};

export function FeaturedCarousel({
  label,
  slides,
  onOpen,
}: {
  /** Accessible section name, e.g. "Featured integrations". */
  label: string;
  slides: FeaturedSlideData[];
  onOpen: (id: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = slides.length;

  // A featured listing can vanish (unlisted mid-session) — stay in range.
  const active = Math.min(index, count - 1);

  const go = (next: number) => setIndex((next + count) % count);

  useEffect(() => {
    if (paused || count < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % count), ADVANCE_MS);
    return () => clearInterval(id);
  }, [paused, count]);

  if (count === 0) return null;

  return (
    <section
      aria-label={label}
      className="group/carousel relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="overflow-hidden rounded-[24px]">
        <motion.div
          className="flex touch-pan-y"
          drag={count > 1 ? "x" : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.18}
          onDragEnd={(_, info) => {
            if (info.offset.x < -60 || info.velocity.x < -400) go(active + 1);
            else if (info.offset.x > 60 || info.velocity.x > 400)
              go(active - 1);
          }}
          animate={{ x: `-${active * 100}%` }}
          transition={slideSpring}
        >
          {slides.map((slide) => (
            <FeaturedSlide
              key={slide.id}
              slide={slide}
              onOpen={() => onOpen(slide.id)}
            />
          ))}
        </motion.div>
      </div>

      {count > 1 && (
        <>
          <CarouselArrow side="left" onClick={() => go(active - 1)} />
          <CarouselArrow side="right" onClick={() => go(active + 1)} />
          <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                aria-label={`Show ${slide.name}`}
                aria-current={i === active}
                onClick={() => go(i)}
                className="flex h-4 items-center"
              >
                <motion.span
                  animate={{
                    width: i === active ? 16 : 5,
                    opacity: i === active ? 1 : 0.55,
                  }}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  className="h-[5px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function FeaturedSlide({
  slide,
  onOpen,
}: {
  slide: FeaturedSlideData;
  onOpen: () => void;
}) {
  // A banner URL the browser can't load (deleted upload, blocked host) falls
  // back to the logo-color backdrop instead of shimmering forever.
  const [bannerFailed, setBannerFailed] = useState(false);
  const bannerUrl = bannerFailed ? null : slide.bannerUrl;
  // Only sampled when there's no banner to paint instead.
  const logoColor = useDominantColor(bannerUrl ? null : slide.logoUrl);

  return (
    <div className="relative w-full shrink-0">
      <div
        className="relative flex min-h-[176px] flex-col justify-end overflow-hidden p-5 pb-8 md:min-h-[192px]"
        style={
          bannerUrl ? undefined : { backgroundColor: logoColor ?? "#3f3f46" }
        }
      >
        {bannerUrl && (
          <>
            {/* FadeInImage is position:relative (it can't be overridden via
                className — later stylesheet rules win), so the full-bleed
                placement lives on this wrapper. */}
            <div className="absolute inset-0">
              <FadeInImage
                src={bannerUrl}
                onError={() => setBannerFailed(true)}
                className="h-full w-full"
              />
            </div>
            {/* Legibility scrim — copy sits on the lower-left. */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
          </>
        )}
        {!bannerUrl && (
          // A soft vignette so flat brand colors don't feel like a swatch.
          <div className="absolute inset-0 bg-[radial-gradient(120%_100%_at_85%_0%,rgba(255,255,255,0.14),transparent_55%),linear-gradient(to_top,rgba(0,0,0,0.35),transparent_60%)]" />
        )}

        <div className="relative flex items-end justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <IntegrationLogo
              name={slide.name}
              logoUrl={slide.logoUrl}
              iconSvg={slide.iconSvg}
              size={52}
              className="shadow-[0_4px_14px_rgba(0,0,0,0.3)]"
            />
            <div className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[16px] font-semibold tracking-tight text-white">
                  {slide.name}
                </span>
                {slide.verified && <VerifiedBadge size={15} />}
              </span>
              <p className="mt-0.5 line-clamp-2 max-w-md text-[12.5px] leading-snug text-white/80">
                {slide.description}
              </p>
            </div>
          </div>

          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            disabled={slide.installed}
            onClick={onOpen}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-neutral-900 shadow-[0_2px_10px_rgba(0,0,0,0.25)] transition hover:bg-white/90 disabled:opacity-80"
          >
            {slide.installed ? (
              <IconCircleCheckFilled size={15} className="text-emerald-500" />
            ) : (
              <IconDownload size={15} stroke={2.25} />
            )}
            {slide.installed ? "Installed" : slide.cta}
          </motion.button>
        </div>
      </div>
    </div>
  );
}

function CarouselArrow({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  const Glyph = side === "left" ? IconChevronLeft : IconChevronRight;
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous" : "Next"}
      onClick={onClick}
      className={`absolute top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white opacity-0 backdrop-blur-sm transition hover:bg-black/55 focus-visible:opacity-100 group-hover/carousel:opacity-100 max-md:hidden ${
        side === "left" ? "left-3" : "right-3"
      }`}
    >
      <Glyph size={16} stroke={2.25} />
    </button>
  );
}
