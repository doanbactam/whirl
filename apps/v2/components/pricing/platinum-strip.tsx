import Link from "next/link";
import { IconArrowRight } from "@tabler/icons-react";

import { PlatinumWordmark } from "@/components/platinum/platinum-wordmark";
import { cn } from "@/lib/utils";

/* The two pricing surfaces don't share a palette: /pricing is the app
   (surface/border/muted tokens), /about/pricing is the marketing shell
   (literal whites and neutral-*). Rather than let one leak into the other,
   the strip carries both dressings. */
const TONES = {
  app: {
    card: "bg-surface ring-border hover:bg-muted",
    title: "text-foreground",
    body: "text-muted-foreground",
    cta: "text-foreground",
  },
  marketing: {
    card: "bg-white ring-black/7 hover:bg-neutral-50 dark:bg-[#161615] dark:ring-white/8 dark:hover:bg-[#1b1b19]",
    title: "text-neutral-900 dark:text-neutral-100",
    body: "text-neutral-500",
    cta: "text-neutral-900 dark:text-neutral-100",
  },
} as const;

/**
 * The quiet Platinum teaser under the plan grid. Deliberately not a fifth
 * card: Platinum isn't the next rung on this ladder, it's a different
 * conversation — and it isn't always for sale. So it gets a band and a
 * "Learn more" rather than a price and a buy button.
 *
 * Server component (no state, no Convex): the strip says nothing about
 * availability, which keeps it renderable on the static marketing page too.
 */
export function PlatinumStrip({
  className,
  tone = "app",
}: {
  className?: string;
  tone?: keyof typeof TONES;
}) {
  const styles = TONES[tone];
  return (
    <Link
      href="/platinum"
      className={cn(
        "group flex flex-col gap-4 rounded-2xl p-5 ring-1 transition-colors sm:flex-row sm:items-center sm:gap-6",
        styles.card,
        className,
      )}
    >
      <PlatinumWordmark height={22} />
      <div className="min-w-0 flex-1">
        <p className={cn("text-[13.5px] font-medium", styles.title)}>
          Beyond Mega.
        </p>
        <p className={cn("mt-0.5 text-[12.5px]/5", styles.body)}>
          A far larger allowance, Fast unmetered, preferential catalog rates.
        </p>
      </div>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium",
          styles.cta,
        )}
      >
        Learn more
        {/* Tailwind v4 emits `translate` as its own property, so the
            transition has to name it — `transition-transform` won't. */}
        <IconArrowRight
          size={14}
          stroke={2.2}
          className="transition-[translate] group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  );
}
