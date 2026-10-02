"use client";

import { useCustomer } from "autumn-js/react";

import { Skeleton } from "@/components/ui/skeleton";
import { readExtraUsage } from "@/lib/extra-usage";
import { formatUsd } from "@/lib/money";
import {
  formatFreeMessagesLeft,
  formatResetsIn,
  readUsageSummary,
} from "@/lib/plan";
import { PlanBadge } from "../../plan-badge";
import { UsageMeter } from "../../usage-meter";
import { SettingsCard } from "../settings-rows";
import { UsageMultiplierBadge } from "../../system-status";

/* The usage tab's headline: how much of the plan pool is left, when it
   refills, and the extra-usage balance waiting behind it (paid customers
   who've topped up only). */
export function UsagePoolCard() {
  const { customer, isLoading } = useCustomer();

  if (!customer && isLoading) {
    return (
      <SettingsCard>
        <div className="p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3 w-10" />
          </div>
          <Skeleton className="mt-3 h-1.5 w-full rounded-full" />
          <div className="mt-2 flex items-center justify-between">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-2.5 w-12" />
          </div>
        </div>
      </SettingsCard>
    );
  }

  const usage = readUsageSummary(customer);
  const extra = readExtraUsage(customer);
  const showExtra = extra.isPaid && extra.included > 0 && !usage.unlimited;

  return (
    <SettingsCard>
      <div className="p-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">
            {usage.freeMessages
              ? "Messages left this period"
              : "Left this period"}
          </span>
          <div className="flex items-center gap-2">
            <UsageMultiplierBadge compact />
            {usage.planId ? (
              <PlanBadge plan={usage.planId} className="h-3 w-auto" />
            ) : (
              <span className="text-xs text-muted-foreground">
                {usage.planName}
              </span>
            )}
          </div>
        </div>
        {usage.freeMessages ? (
          <>
            <UsageMeter remainingPct={usage.remainingPct} className="mt-3" />
            <div className="mt-2 flex items-center justify-between gap-4 text-[13px]/[18px] text-muted-foreground">
              <span className="truncate">
                {usage.nextResetAt
                  ? `Resets in ${formatResetsIn(usage.nextResetAt)}`
                  : "This period"}
              </span>
              <span className="shrink-0 font-medium whitespace-nowrap text-foreground">
                {formatFreeMessagesLeft(usage.freeMessages)}
              </span>
            </div>
          </>
        ) : usage.unlimited ? (
          <p className="mt-1 text-[13px]/[18px] text-muted-foreground">
            Unlimited — there&apos;s no bar to run down.
          </p>
        ) : (
          <>
            <UsageMeter remainingPct={usage.remainingPct} className="mt-3" />
            <div className="mt-2 flex items-center justify-between gap-4 text-[13px]/[18px] text-muted-foreground">
              <span className="truncate">
                {usage.nextResetAt
                  ? `Resets in ${formatResetsIn(usage.nextResetAt)}`
                  : "This period"}
              </span>
              <span className="shrink-0 font-medium tabular-nums whitespace-nowrap text-foreground">
                {Math.round(usage.remainingPct)}% left
              </span>
            </div>
          </>
        )}
        {showExtra && (
          <div className="mt-3 flex items-center justify-between gap-4 border-t border-border pt-3 text-[13px]/[18px]">
            <span className="text-muted-foreground">Extra usage on deck</span>
            <span className="shrink-0 font-medium tabular-nums whitespace-nowrap text-foreground">
              {formatUsd(extra.balance)}
            </span>
          </div>
        )}
      </div>
    </SettingsCard>
  );
}
