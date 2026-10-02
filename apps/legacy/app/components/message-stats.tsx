import { IconChartPieFilled, IconClock, IconCpu } from "@tabler/icons-react";
import { useCustomer } from "autumn-js/react";

import { useActiveMultiplier } from "~/lib/admin";
import { useShowStatsPref } from "~/lib/stats";

function formatTokens(tokens: number): string {
  return tokens.toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds % 60);
  return remSeconds > 0 ? `${minutes}m ${remSeconds}s` : `${minutes}m`;
}

function formatPercent(pct: number): string {
  if (pct < 0.01) return "<0.01%";
  if (pct < 1) return `${pct.toFixed(2)}%`;
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

/**
 * Share of the plan's monthly usage allowance one reply consumed, as a
 * percentage — null when it can't be shown (no cost yet, free plan without a
 * usage pool, or unlimited). Mirrors the settings UsagePane: an active
 * usage-multiplier event (e.g. 0.5 for "2× usage") shrinks the charge.
 */
function useUsagePercent(usageCost?: number): number | null {
  const { customer } = useCustomer();
  const multiplierEvent = useActiveMultiplier();
  if (typeof usageCost !== "number" || usageCost <= 0) return null;
  const usage = (
    customer?.features as
      | Record<
          string,
          { unlimited?: boolean; included_usage?: number } | undefined
        >
      | undefined
  )?.usage;
  if (!usage || usage.unlimited) return null;
  const included =
    typeof usage.included_usage === "number" ? usage.included_usage : 0;
  if (included <= 0) return null;
  const factor =
    multiplierEvent && multiplierEvent.multiplier > 0
      ? multiplierEvent.multiplier
      : 1;
  return ((usageCost * factor) / included) * 100;
}

/**
 * Subtle stat chips that sit at the end of an assistant message's action row —
 * output tokens (reasoning included), how long the response took, and what
 * slice of the plan's usage allowance it ate. Only shown when the user turns
 * on "Show stats" in settings and the numbers are present.
 */
export function MessageStats({
  outputTokens,
  durationMs,
  usageCost,
}: {
  outputTokens?: number;
  durationMs?: number;
  usageCost?: number;
}) {
  const show = useShowStatsPref();
  const usagePct = useUsagePercent(usageCost);

  const hasTokens = typeof outputTokens === "number" && outputTokens > 0;
  const hasDuration = typeof durationMs === "number" && durationMs > 0;

  if (!show || (!hasTokens && !hasDuration && usagePct == null)) return null;

  return (
    <div className="ml-1.5 flex items-center gap-2.5 px-0.5 text-[11.5px] font-medium tabular-nums text-neutral-400 dark:text-neutral-500">
      {hasTokens && (
        <span
          className="inline-flex items-center gap-1"
          title="Output tokens (reasoning included)"
        >
          <IconCpu size={12} stroke={2} />
          {formatTokens(outputTokens)} tokens
        </span>
      )}
      {hasDuration && (
        <span className="inline-flex items-center gap-1" title="Response time">
          <IconClock size={12} stroke={2} />
          {formatDuration(durationMs)}
        </span>
      )}
      {usagePct != null && (
        <span
          className="inline-flex items-center gap-1"
          title="Share of your plan's usage this reply used"
        >
          <IconChartPieFilled size={12} />
          {formatPercent(usagePct)}
        </span>
      )}
    </div>
  );
}
