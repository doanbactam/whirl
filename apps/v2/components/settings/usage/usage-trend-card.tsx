"use client";

import { useEffect, useMemo, useState } from "react";
import { useCustomer } from "autumn-js/react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  formatMessageCount,
  readUsageSummary,
  type CustomerLike,
} from "@/lib/plan";
import {
  formatPlanPct,
  readPeriodWindow,
  rowPlanCost,
  type UsageRow,
} from "@/lib/usage-data";
import { SettingsCard } from "../settings-rows";

/* Chart canvas: fixed viewBox scaled uniformly to the card, so strokes and
   the dot radius stay honest. */
const W = 296;
const H = 116;
const PAD_X = 4;
const PAD_TOP = 14;
const PAD_BOTTOM = 16;

/* Recent-weighted burn rate: the last 3 days say more about tomorrow than
   the whole period does; fall back to the period average when the window
   is empty. */
const RATE_WINDOW_MS = 3 * 86_400_000;

/* The y-axis zooms to the story, but never silently: it snaps to a round
   ceiling and says so on the chart, so a quiet 2% week can't masquerade
   as a climb to the moon. */
const NICE_CEILINGS = [5, 10, 25, 50, 100];

type Trend = {
  periodStart: number;
  domainEnd: number;
  hasReset: boolean;
  isFree: boolean;
  used: number;
  limit: number;
  /** Cumulative history: (t, amount) steps from the period's spend. */
  line: { t: number; amount: number }[];
  /** Dashed continuation from "now" at the recent burn rate. */
  projection: { to: { t: number; amount: number } } | null;
  verdict: string;
};

function buildTrend(
  rows: UsageRow[],
  customer: CustomerLike,
  now: number,
): Trend | null {
  const usage = readUsageSummary(customer);
  if (usage.unlimited) return null;
  const paid = usage.planId !== null;
  const isFree = !paid;

  const { start: periodStart, resetAt: reset } = readPeriodWindow(
    customer,
    now,
  );
  const limit = usage.freeMessages?.included ?? 100;
  const used =
    usage.freeMessages?.used ??
    Math.min(100, Math.max(0, 100 - usage.remainingPct));

  /* Cumulative plan spend, rescaled so the curve lands exactly on Autumn's
     authoritative "used so far" — per-row costs don't know about usage
     multipliers, the balance does. */
  let cumulative = 0;
  const raw = rows
    .filter((row) => row.createdAt >= periodStart && row.createdAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((row) => {
      cumulative += paid ? rowPlanCost(row) : 1;
      return { t: row.createdAt, value: cumulative };
    });
  const line = [
    { t: periodStart, amount: 0 },
    ...raw.map(({ t, value }) => ({
      t,
      amount:
        cumulative > 0 && used > 0
          ? Math.min(limit, (value / cumulative) * used)
          : 0,
    })),
    { t: now, amount: used },
  ];

  /* Burn rate in plan units/ms from the recent window, then the forecast. */
  const windowStart = Math.max(periodStart, now - RATE_WINDOW_MS);
  let amountAtWindowStart = 0;
  for (const point of line) {
    if (point.t <= windowStart) amountAtWindowStart = point.amount;
  }
  const recentRate =
    now > windowStart ? (used - amountAtWindowStart) / (now - windowStart) : 0;
  const periodRate = now > periodStart ? used / (now - periodStart) : 0;
  const rate = recentRate > 0 ? recentRate : periodRate;

  const domainEnd = reset ?? now + (now - periodStart) / 4;
  let projection: Trend["projection"] = null;
  let verdict: string;
  if (used >= limit) {
    verdict = "Limit hit — the reset takes it from here.";
  } else if (rate <= 0) {
    verdict = isFree ? "No messages used lately." : "No spend lately.";
  } else {
    const hitTime = now + (limit - used) / rate;
    if (hitTime <= domainEnd) {
      projection = { to: { t: hitTime, amount: limit } };
      verdict = `Out around ${new Date(hitTime).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })} at this pace.`;
    } else {
      const endAmount = Math.min(limit, used + rate * (domainEnd - now));
      projection = { to: { t: domainEnd, amount: endAmount } };
      verdict = reset
        ? isFree
          ? `On pace to use ${formatMessageCount(Math.ceil(endAmount))} by the reset.`
          : `On pace for ${formatPlanPct(endAmount)} by the reset.`
        : "Cruising well under the limit.";
    }
  }

  return {
    periodStart,
    domainEnd,
    hasReset: reset !== null,
    isFree,
    used,
    limit,
    line,
    projection,
    verdict,
  };
}

/* The plan spend as one cumulative line: solid is history, dashed is the
   recent pace carried to the reset. The scale is labeled, so the zoom is
   never a secret. */
export function UsageTrendCard({ rows }: { rows: UsageRow[] | undefined }) {
  const { customer, isLoading } = useCustomer();
  /* One mount-time clock keeps the geometry and copy in agreement (and the
     render pure — Date.now() belongs in an effect, not the render pass). */
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setNow(Date.now()));
    return () => cancelAnimationFrame(id);
  }, []);

  const trend = useMemo(
    () =>
      rows && customer && now !== null ? buildTrend(rows, customer, now) : null,
    [rows, customer, now],
  );

  if (rows === undefined || (!customer && isLoading) || now === null) {
    return (
      <SettingsCard>
        <div className="p-4">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="mt-2 h-3 w-44" />
          <Skeleton className="mt-3 h-[116px] w-full rounded-lg" />
        </div>
      </SettingsCard>
    );
  }

  if (!trend) {
    return (
      <SettingsCard>
        <div className="p-4">
          <span className="text-sm font-medium">The pace</span>
          <p className="mt-1 text-[13px]/[18px] text-muted-foreground">
            Unlimited plan — nothing to pace.
          </p>
        </div>
      </SettingsCard>
    );
  }

  const {
    periodStart,
    domainEnd,
    hasReset,
    isFree,
    used,
    limit,
    line,
    projection,
    verdict,
  } = trend;
  const span = Math.max(1, domainEnd - periodStart);
  const x = (t: number) => PAD_X + ((t - periodStart) / span) * (W - PAD_X * 2);

  const peak = Math.max(used, projection?.to.amount ?? 0);
  const ceilings = isFree
    ? [...new Set([1, 2, 5, 10, limit])].sort((a, b) => a - b)
    : NICE_CEILINGS;
  const yMax =
    peak >= limit
      ? limit
      : (ceilings.find((ceiling) => ceiling >= peak * 1.15) ?? limit);
  const y = (amount: number) =>
    PAD_TOP + (1 - amount / yMax) * (H - PAD_TOP - PAD_BOTTOM);

  const linePath = line
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t)} ${y(p.amount)}`)
    .join(" ");

  return (
    <SettingsCard>
      <div className="p-4">
        <span className="text-sm font-medium">The pace</span>
        <p className="mt-1 truncate text-[13px]/[18px] text-muted-foreground">
          {verdict}
        </p>
        {used <= 0 && !projection ? (
          <div className="flex h-[116px] items-center justify-center text-[13px]/[18px] text-muted-foreground">
            {isFree
              ? "No messages used this period yet."
              : "Nothing plotted this period yet."}
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full">
            {/* The frame: a baseline, and a labeled ceiling so the zoom
                level is visible at a glance. */}
            <line
              x1={PAD_X}
              x2={W - PAD_X}
              y1={y(0)}
              y2={y(0)}
              className="stroke-border"
              strokeWidth="1"
            />
            <line
              x1={PAD_X}
              x2={W - PAD_X}
              y1={y(yMax)}
              y2={y(yMax)}
              className="stroke-border"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <text
              x={PAD_X}
              y={y(yMax) - 4}
              className="fill-muted-foreground text-[8px]"
            >
              {yMax === limit
                ? isFree
                  ? "message limit"
                  : "plan limit"
                : isFree
                  ? formatMessageCount(yMax)
                  : `${yMax}% of the plan`}
            </text>

            {/* Spent so far: a soft wash under the history line. */}
            <path
              d={`${linePath} L ${x(line[line.length - 1].t)} ${y(0)} L ${x(periodStart)} ${y(0)} Z`}
              className="fill-emerald-500 dark:fill-emerald-400"
              fillOpacity="0.08"
            />
            <path
              d={linePath}
              fill="none"
              className="stroke-emerald-500 dark:stroke-emerald-400"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* The forecast: same line, faded and dashed. */}
            {projection && (
              <line
                x1={x(now)}
                y1={y(used)}
                x2={x(projection.to.t)}
                y2={y(projection.to.amount)}
                className="stroke-emerald-500 dark:stroke-emerald-400"
                strokeOpacity="0.4"
                strokeWidth="2"
                strokeDasharray="3 4"
                strokeLinecap="round"
              />
            )}

            {/* Where you stand right now. */}
            <circle
              cx={x(now)}
              cy={y(used)}
              r="3"
              className="fill-emerald-500 stroke-surface dark:fill-emerald-400"
              strokeWidth="1.5"
            />

            <text
              x={PAD_X}
              y={H - 4}
              className="fill-muted-foreground text-[8px]"
            >
              {new Date(periodStart).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </text>
            <text
              x={W - PAD_X}
              y={H - 4}
              textAnchor="end"
              className="fill-muted-foreground text-[8px]"
            >
              {`${hasReset ? "resets " : ""}${new Date(
                domainEnd,
              ).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}`}
            </text>
          </svg>
        )}
      </div>
    </SettingsCard>
  );
}
