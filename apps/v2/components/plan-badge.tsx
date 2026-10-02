import type { PlanId } from "@/lib/plan";
import { cn } from "@/lib/utils";

/* Both Platinum tiers wear the same wordmark — the badge says the line, the
   "Max" is carried in copy beside it. One asset, deliberately. */
const BADGE_FILES: Partial<Record<PlanId, string>> = {
  platinum_max: "platinum",
};

/** The badge art for a plan. Shared so no surface can ask for a file that
    isn't in /public/plan-badges. */
export function planBadgeSrc(plan: PlanId): string {
  return `/plan-badges/${BADGE_FILES[plan] ?? plan}.svg`;
}

/** Plan wordmark from /public/plan-badges, flattened to monochrome. The
    opacities land the flattened black/white on the chrome's soft ink
    (--foreground-soft) rather than full contrast. `className` is for
    sizing. */
export function PlanBadge({
  plan,
  className = "h-4 w-auto",
}: {
  plan: PlanId;
  className?: string;
}) {
  return (
    <img
      src={planBadgeSrc(plan)}
      alt={`${plan} plan`}
      className={cn(
        "shrink-0 brightness-0 opacity-65 dark:opacity-70 dark:invert",
        className,
      )}
    />
  );
}
