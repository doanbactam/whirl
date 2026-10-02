type PlanId = "mini" | "turbo" | "mega";

/** Full-color plan wordmark from /public/plan-badges. */
export function PlanBadge({
  plan,
  className = "h-4 w-auto shrink-0",
}: {
  plan: PlanId;
  className?: string;
}) {
  return (
    <img
      src={`/plan-badges/${plan}.svg`}
      alt={`${plan} plan`}
      className={className}
    />
  );
}

/** Muted plan wordmark for dense menus (model gates, etc.). */
export function MutedPlanBadge({
  plan,
  className = "h-3.5 w-auto shrink-0 brightness-0 opacity-50 dark:opacity-60 dark:invert",
}: {
  plan: PlanId;
  className?: string;
}) {
  return (
    <img
      src={`/plan-badges/${plan}.svg`}
      alt={`${plan} plan`}
      className={className}
    />
  );
}
