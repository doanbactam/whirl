"use client";

import { useState } from "react";
import { useCustomer } from "autumn-js/react";

import { ModelGlyph } from "@/components/model-glyph";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatUsdFine } from "@/lib/money";
import { readUsageSummary } from "@/lib/plan";
import {
  formatPlanPct,
  formatRowDate,
  formatTokens,
  rowPlanCost,
  rowTokens,
  useUsageModelLookup,
  type TokenBreakdown,
  type UsageRow,
} from "@/lib/usage-data";
import { SettingsCard } from "../settings-rows";

const COLS =
  "grid grid-cols-[minmax(0,6.5rem)_5.5rem_minmax(0,1fr)_5.5rem_5rem] items-center gap-3";

const COLLAPSED_ROWS = 25;

function TokenTip({ breakdown }: { breakdown: TokenBreakdown }) {
  const lines: [string, number][] = [
    ["Prompt", breakdown.input],
    ["Output", breakdown.output],
  ];
  return (
    <div className="min-w-36 py-0.5">
      {lines.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular-nums">{formatTokens(value)}</span>
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between gap-4 border-t border-border pt-1 font-medium">
        <span>Total</span>
        <span className="tabular-nums">{formatTokens(breakdown.total)}</span>
      </div>
    </div>
  );
}

/* Every request that cost anything, newest first. Cost speaks the user's
   currency: share of the plan pool, "1 message" on the free tier, or real
   dollars when the extra-usage bucket picked up the tab. */
export function UsageTable({ rows }: { rows: UsageRow[] | undefined }) {
  const { customer } = useCustomer();
  const lookupModel = useUsageModelLookup();
  const [showAll, setShowAll] = useState(false);

  const usage = readUsageSummary(customer);
  const paid = usage.planId !== null;
  const features = customer?.features as
    | Record<string, { included_usage?: number | null } | undefined>
    | undefined;
  const includedUsd = features?.usage?.included_usage ?? 0;

  const costLabel = (row: UsageRow): string => {
    if (row.extraUsageCost > 0) return formatUsdFine(row.extraUsageCost);
    if (!paid) return "1 message";
    if (includedUsd > 0)
      return formatPlanPct((rowPlanCost(row) / includedUsd) * 100);
    return formatUsdFine(row.usageCost);
  };

  const visible = rows && !showAll ? rows.slice(0, COLLAPSED_ROWS) : rows;

  return (
    <SettingsCard>
      <div
        className={`${COLS} px-4 py-2.5 text-[13px] font-medium text-muted-foreground`}
      >
        <span>Date</span>
        <span>Type</span>
        <span>Model</span>
        <span className="text-right">Tokens</span>
        <span className="text-right">Cost</span>
      </div>

      {rows === undefined ? (
        <ul className="divide-y divide-border">
          {Array.from({ length: 5 }, (_, index) => (
            <li key={index} className={`${COLS} px-4 py-3`}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-12 justify-self-end" />
              <Skeleton className="h-3 w-10 justify-self-end" />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-[13px]/[18px] text-muted-foreground">
          No requests yet — send a message and it&apos;ll show up here.
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {visible!.map((row) => {
              const model = lookupModel(row.model);
              const breakdown = rowTokens(row);
              const extra = row.extraUsageCost > 0;
              return (
                <li key={row.id} className={`${COLS} px-4 py-2.5`}>
                  <span className="truncate text-[13px] tabular-nums text-muted-foreground">
                    {formatRowDate(row.createdAt)}
                  </span>
                  <span className="truncate text-[13px] text-muted-foreground">
                    {extra ? "Extra usage" : "Included"}
                  </span>
                  <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
                    <ModelGlyph
                      model={model}
                      size={15}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="truncate">{model.name}</span>
                  </span>
                  {breakdown ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="cursor-default text-right text-[13px] tabular-nums" />
                        }
                      >
                        {formatTokens(breakdown.total)}
                      </TooltipTrigger>
                      <TooltipContent>
                        <TokenTip breakdown={breakdown} />
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="text-right text-[13px] text-muted-foreground">
                      —
                    </span>
                  )}
                  <span className="text-right text-[13px] font-medium tabular-nums">
                    {costLabel(row)}
                  </span>
                </li>
              );
            })}
          </ul>
          {!showAll && rows.length > COLLAPSED_ROWS && (
            <div className="flex justify-center p-2">
              <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                Show all {rows.length}
              </Button>
            </div>
          )}
        </>
      )}
    </SettingsCard>
  );
}
