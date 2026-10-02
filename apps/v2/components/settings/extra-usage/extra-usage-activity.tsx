"use client";

import { useMemo } from "react";

import { ModelGlyph } from "@/components/model-glyph";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsd, formatUsdFine } from "@/lib/money";
import {
  formatRowDate,
  useUsageModelLookup,
  type UsageRow,
} from "@/lib/usage-data";
import { SettingsCard } from "../settings-rows";

const COLS = "grid grid-cols-[minmax(0,1fr)_auto_5rem] items-center gap-3";

/**
 * Recent requests that actually drew from the extra-usage bucket, shown in
 * real dollars — so a paid customer sees exactly what their purchased balance
 * has covered (everything billed to the plan pool is filtered out).
 */
export function ExtraUsageActivity({ rows }: { rows: UsageRow[] | undefined }) {
  const lookupModel = useUsageModelLookup();

  const extraRows = useMemo(
    () => rows?.filter((row) => row.extraUsageCost > 0),
    [rows],
  );
  const total = useMemo(
    () => (extraRows ?? []).reduce((acc, row) => acc + row.extraUsageCost, 0),
    [extraRows],
  );

  return (
    <SettingsCard>
      <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
        <span className="text-[13px] font-medium text-muted-foreground">
          Drawn from extra usage
        </span>
        {extraRows && extraRows.length > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatUsd(total)} across {extraRows.length}{" "}
            {extraRows.length === 1 ? "request" : "requests"}
          </span>
        )}
      </div>

      {extraRows === undefined ? (
        <ul className="divide-y divide-border">
          {Array.from({ length: 3 }, (_, index) => (
            <li key={index} className={`${COLS} px-4 py-3`}>
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-12 justify-self-end" />
            </li>
          ))}
        </ul>
      ) : extraRows.length === 0 ? (
        <div className="px-4 py-8 text-center text-[13px]/[18px] text-muted-foreground">
          Nothing drawn from extra usage yet — your plan&apos;s covered
          everything so far.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {extraRows.map((row) => {
            const model = lookupModel(row.model);
            return (
              <li key={row.id} className={`${COLS} px-4 py-2.5`}>
                <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
                  <ModelGlyph
                    model={model}
                    size={15}
                    className="shrink-0 text-muted-foreground"
                  />
                  <span className="truncate">{model.name}</span>
                </span>
                <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                  {formatRowDate(row.createdAt)}
                </span>
                <span className="text-right text-[13px] font-medium tabular-nums">
                  {formatUsdFine(row.extraUsageCost)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsCard>
  );
}
