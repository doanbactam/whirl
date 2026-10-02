import { IconSparkles } from "@tabler/icons-react";

import { multiplierLabel, useActiveMultiplier } from "~/lib/admin";

/**
 * Playful little chip surfaced in the usage UI (account menu + settings) while a
 * usage-multiplier event is running: a surface-colored pill with a continuously
 * rotating rainbow outline. Renders nothing when no event is active — and, for free-plan
 * context, only when the event actually scales free messages.
 */
export function UsageMultiplierBadge({
  context = "paid",
  className = "",
}: {
  context?: "paid" | "free";
  className?: string;
}) {
  const event = useActiveMultiplier();
  if (!event) return null;
  if (context === "free" && !event.applyToFreeMessages) return null;

  const label = multiplierLabel(event.multiplier);

  return (
    <span
      className={`relative inline-flex w-fit max-w-full self-start overflow-hidden rounded-full p-[1.5px] ${className}`}
    >
      {/* Rotating rainbow ring. Oversized square so it always covers the pill
          at every angle; the wrapper's overflow-hidden clips it to the radius. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[320%] -translate-x-1/2 -translate-y-1/2 animate-spin [animation-duration:3s]"
        style={{
          background:
            "conic-gradient(from 0deg, #ff5f6d, #ffc371, #fff95b, #5dff7b, #5bc0ff, #9b5bff, #ff5be7, #ff5f6d)",
        }}
      />
      <span className="relative inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 dark:bg-[#1E1E1E]">
        <IconSparkles
          size={13}
          stroke={2}
          className="shrink-0 text-[#9b5bff] dark:text-[#b58bff]"
        />
        <span className="text-[11px] font-semibold text-neutral-900 dark:text-neutral-100">
          {label} usage active
        </span>
        <span className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
          — go wild
        </span>
      </span>
    </span>
  );
}
