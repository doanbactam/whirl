"use client";

import { useCustomer } from "autumn-js/react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  formatFreeMessagesLeft,
  formatResetsIn,
  readUsageSummary,
} from "@/lib/plan";
import { PlanBadge } from "../plan-badge";
import { UsageMeter } from "../usage-meter";
import { SettingsCard } from "./settings-rows";

/* The user-menu usage block, re-cut for the roomier settings card. */
export function UsageCard() {
  const { customer, isLoading } = useCustomer();

  if (!customer && isLoading) {
    return (
      <SettingsCard>
        <div className="p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-14" />
            <Skeleton className="h-3 w-10" />
          </div>
          <Skeleton className="mt-3 h-1.5 w-full rounded-full" />
          <div className="mt-2 flex items-center justify-between">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-2.5 w-10" />
          </div>
        </div>
      </SettingsCard>
    );
  }

  const usage = readUsageSummary(customer);

  return (
    <SettingsCard>
      <div className="p-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">Usage</span>
          {usage.planId ? (
            <PlanBadge plan={usage.planId} className="h-3 w-auto" />
          ) : (
            <span className="text-xs text-muted-foreground">
              {usage.planName}
            </span>
          )}
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
            Unlimited messages — go wild.
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
      </div>
    </SettingsCard>
  );
}
