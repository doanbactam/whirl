"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlatinumTier } from "./platinum-catalog";

export type TierAction = {
  label: string;
  disabled: boolean;
  /** Softens the button on states that aren't an invitation to click. */
  quiet: boolean;
  onClick: () => void;
};

export function PlatinumTierCard({
  tier,
  action,
  note,
}: {
  tier: PlatinumTier;
  /** Null while we're still learning whether Platinum is open — the button
      would otherwise flip its own label a beat after paint. */
  action: TierAction | null;
  /** One line under the button — membership state, mostly. */
  note?: string | null;
}) {
  return (
    <article className="flex min-w-0 flex-col rounded-3xl bg-surface p-7 ring-1 ring-border">
      <h2 className="text-[12.5px] font-medium tracking-wide text-muted-foreground">
        {tier.name}
      </h2>
      <p className="mt-3 text-[19px] font-semibold tracking-tight">
        {tier.tagline}
      </p>

      <div className="mt-7 flex items-baseline gap-2">
        <span className="text-[42px] font-semibold tracking-tight tabular-nums">
          ${tier.price}
        </span>
        <span className="text-[12.5px] text-muted-foreground">
          USD per month
        </span>
      </div>

      {/* Each feature wears its own icon rather than a row of identical
          ticks — on a two-card page the glyphs are what let you compare the
          tiers at a glance. */}
      <ul className="mt-8 flex flex-1 flex-col gap-3.5">
        {tier.features.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-3 text-[13.5px]/5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-foreground-soft">
              <Icon size={13} stroke={2} />
            </span>
            {label}
          </li>
        ))}
      </ul>

      {action ? (
        <Button
          size="lg"
          variant={action.quiet ? "secondary" : "default"}
          className="mt-9 w-full"
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ) : (
        <Skeleton className="mt-9 h-9 w-full rounded-lg" />
      )}
      {note && (
        <p className="mt-3 text-center text-[12px]/4 text-muted-foreground">
          {note}
        </p>
      )}
    </article>
  );
}
