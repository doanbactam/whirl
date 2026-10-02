"use client";

import { useEffect, useMemo, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { useCustomer } from "autumn-js/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatPlanPct,
  readPeriodWindow,
  rowTokens,
  startOfWeek,
  useUsageModelLookup,
  type UsageRow,
} from "@/lib/usage-data";
import { formatMessageCount, readUsageSummary } from "@/lib/plan";
import { SettingsCard } from "../settings-rows";

type Mode = "tokens" | "cost";

type Slice = {
  key: string;
  label: string;
  value: number;
  share: number;
  style: SliceStyle;
};

type SliceStyle = { fill: string; stroke: string; swatch: string };

/* Categorical slots from the validated dataviz palette (adjacent-pair CVD
   safe in this order, light and dark steps per mode). Color follows the
   model, never its rank — assignments come from the all-time ordering, so
   switching weeks or measures never repaints a model. */
const SLICE_STYLES: SliceStyle[] = [
  {
    fill: "fill-[#2a78d6] dark:fill-[#3987e5]",
    stroke: "stroke-[#2a78d6] dark:stroke-[#3987e5]",
    swatch: "bg-[#2a78d6] dark:bg-[#3987e5]",
  },
  {
    fill: "fill-[#008300]",
    stroke: "stroke-[#008300]",
    swatch: "bg-[#008300]",
  },
  {
    fill: "fill-[#e87ba4] dark:fill-[#d55181]",
    stroke: "stroke-[#e87ba4] dark:stroke-[#d55181]",
    swatch: "bg-[#e87ba4] dark:bg-[#d55181]",
  },
  {
    fill: "fill-[#eda100] dark:fill-[#c98500]",
    stroke: "stroke-[#eda100] dark:stroke-[#c98500]",
    swatch: "bg-[#eda100] dark:bg-[#c98500]",
  },
  {
    fill: "fill-[#1baf7a] dark:fill-[#199e70]",
    stroke: "stroke-[#1baf7a] dark:stroke-[#199e70]",
    swatch: "bg-[#1baf7a] dark:bg-[#199e70]",
  },
];
const OTHER_STYLE: SliceStyle = {
  fill: "fill-muted-foreground",
  stroke: "stroke-muted-foreground",
  swatch: "bg-muted-foreground",
};

const WEEK_MS = 7 * 86_400_000;

type WindowOption = { key: string; label: string; start: number; end: number };

const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

const COMPACT = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const messageUnit = (count: number) => (count === 1 ? "message" : "messages");

/** Annular sector from `start` to `end` (radians, clockwise from 12 o'clock). */
function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number,
): string {
  const point = (r: number, angle: number) => {
    const a = angle - Math.PI / 2;
    return `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  };
  const large = end - start > Math.PI ? 1 : 0;
  return [
    `M ${point(rOuter, start)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${point(rOuter, end)}`,
    `L ${point(rInner, end)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${point(rInner, start)}`,
    "Z",
  ].join(" ");
}

/* How the selected window's activity splits across models — a donut that can
   speak in tokens, paid-plan percentage, or concrete free-plan messages.
   Defaults to the current usage period; the dropdown narrows it to a single
   week. Hovering a slice (or its legend row) puts that model's numbers in the
   middle. */
export function ModelMixCard({ rows }: { rows: UsageRow[] | undefined }) {
  const [mode, setMode] = useState<Mode>("tokens");
  const [windowKey, setWindowKey] = useState("period");
  const [active, setActive] = useState<number | null>(null);
  const lookupModel = useUsageModelLookup();
  const { customer } = useCustomer();
  const usage = readUsageSummary(customer);
  const isFree = customer != null && usage.freeMessages !== null;

  /* Mount-time clock, set in an effect to keep the render pure. */
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setNow(Date.now()));
    return () => cancelAnimationFrame(id);
  }, []);

  /* Cost mode speaks plan percentage, never dollars — same currency as the
     table's cost column. Free customers have no USD pool, so this becomes a
     message-count mode instead. */
  const features = customer?.features as
    Record<string, { included_usage?: number | null } | undefined> | undefined;
  const includedUsd = features?.usage?.included_usage ?? 0;

  const windows = useMemo<WindowOption[]>(() => {
    if (now === null) return [];
    const period = readPeriodWindow(customer, now);
    const thisWeek = startOfWeek(now);
    const weeks = Array.from({ length: 4 }, (_, i) => {
      const start = thisWeek - i * WEEK_MS;
      const label =
        i === 0
          ? "This week"
          : i === 1
            ? "Last week"
            : `${dayLabel(start)} – ${dayLabel(start + WEEK_MS - 1)}`;
      return { key: `week-${i}`, label, start, end: start + WEEK_MS };
    });
    return [
      { key: "period", label: "This period", start: period.start, end: now },
      ...weeks,
    ];
  }, [customer, now]);

  const window_ = windows.find((w) => w.key === windowKey) ?? windows[0];

  /* All-time ranking pins each model to one color slot, no matter which
     window or measure is on screen. */
  const styleByModel = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of rows ?? []) {
      totals.set(
        row.model,
        (totals.get(row.model) ?? 0) + (isFree ? 1 : row.usageCost),
      );
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const styles = new Map<string, SliceStyle>();
    ranked.forEach(([model], index) => {
      styles.set(model, SLICE_STYLES[index] ?? OTHER_STYLE);
    });
    return styles;
  }, [rows, isFree]);

  const slices = useMemo<Slice[]>(() => {
    if (!rows || !window_) return [];
    const byModel = new Map<string, number>();
    for (const row of rows) {
      if (row.createdAt < window_.start || row.createdAt >= window_.end)
        continue;
      const value =
        mode === "tokens"
          ? (rowTokens(row)?.total ?? 0)
          : isFree
            ? 1
            : row.usageCost;
      if (value <= 0) continue;
      byModel.set(row.model, (byModel.get(row.model) ?? 0) + value);
    }
    const named = [...byModel.entries()].filter(
      ([model]) => styleByModel.get(model) !== OTHER_STYLE,
    );
    const other = [...byModel.entries()]
      .filter(([model]) => styleByModel.get(model) === OTHER_STYLE)
      .reduce((acc, [, value]) => acc + value, 0);
    const entries: [string, number][] = [
      ...named.sort((a, b) => b[1] - a[1]),
      ...(other > 0 ? ([["__other", other]] as [string, number][]) : []),
    ];
    const total = entries.reduce((acc, [, value]) => acc + value, 0);
    if (total <= 0) return [];
    return entries.map(([key, value]) => ({
      key,
      label: key === "__other" ? "Other" : lookupModel(key).name,
      value,
      share: value / total,
      style:
        key === "__other"
          ? OTHER_STYLE
          : (styleByModel.get(key) ?? OTHER_STYLE),
    }));
  }, [rows, window_, mode, isFree, lookupModel, styleByModel]);

  const total = slices.reduce((acc, slice) => acc + slice.value, 0);
  const activeSlice = active !== null ? slices[active] : undefined;

  const messageMode = mode === "cost" && isFree;
  const showValues = mode === "tokens" || messageMode || includedUsd > 0;
  const formatValue = (value: number): string =>
    mode === "tokens"
      ? COMPACT.format(value)
      : messageMode
        ? formatMessageCount(value)
        : formatPlanPct((value / includedUsd) * 100);

  /* Slice geometry: surface-colored strokes carve the gaps; sliver slices
     give up their gap before the arc could invert. */
  const GAP = 0.03;
  let angle = 0;
  const paths = slices.map((slice) => {
    const start = angle;
    const end = angle + slice.share * Math.PI * 2;
    angle = end;
    const pad = Math.min(GAP / 2, (end - start) / 4);
    return { slice, start, end, pad };
  });

  /* The middle has its own line for the unit, so the number goes in bare —
     "messages" over "5", never "messages" over "5 messages". It also has to
     stay inside the donut's cutout, which is why nothing long belongs here. */
  const formatCenterValue = (value: number): string =>
    messageMode ? String(Math.max(0, Math.floor(value))) : formatValue(value);

  const centerTitle = activeSlice
    ? activeSlice.label
    : mode === "tokens"
      ? "tokens"
      : messageMode
        ? messageUnit(total)
        : showValues
          ? "of plan"
          : "of spend";
  const centerValue = activeSlice
    ? showValues
      ? formatCenterValue(activeSlice.value)
      : `${Math.round(activeSlice.share * 100)}%`
    : showValues
      ? formatCenterValue(total)
      : "100%";
  /* With a slice hovered the title becomes the model's name, so the unit
     drops to the third line rather than going unsaid. */
  const centerSub = !activeSlice
    ? null
    : messageMode
      ? messageUnit(activeSlice.value)
      : showValues && !isFree
        ? `${Math.round(activeSlice.share * 100)}%`
        : null;

  return (
    <SettingsCard>
      <div className="flex h-full flex-col p-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">By model</span>
          <div
            role="radiogroup"
            aria-label="Chart measure"
            className="flex rounded-full bg-well p-0.5 shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]"
          >
            {(["tokens", "cost"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                onClick={() => {
                  setMode(option);
                  setActive(null);
                }}
                className={`h-6 cursor-pointer rounded-full px-2.5 text-xs font-medium transition-[background-color,color] duration-150 ${
                  mode === option
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option === "tokens" ? "Tokens" : isFree ? "Messages" : "Cost"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-7 cursor-pointer items-center gap-1 rounded-full bg-well px-2.5 text-xs font-medium text-muted-foreground shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)] transition-[background-color,color] duration-150 hover:bg-[color-mix(in_oklch,var(--well),var(--foreground)_5%)] hover:text-foreground">
              {window_?.label ?? "This period"}
              <IconChevronDown size={13} />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-auto min-w-40">
              <DropdownMenuRadioGroup
                value={windowKey}
                onValueChange={(value) => {
                  setWindowKey(value);
                  setActive(null);
                }}
              >
                {windows.map((option) => (
                  <DropdownMenuRadioItem key={option.key} value={option.key}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {rows === undefined || now === null ? (
          <div className="flex flex-1 flex-col items-center gap-4 pt-5">
            <Skeleton className="size-36 rounded-full" />
            <div className="w-full space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ) : slices.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-4 py-10 text-center text-[13px]/[18px] text-muted-foreground">
            {mode === "tokens"
              ? "No token counts in this window — new messages carry them."
              : messageMode
                ? "No messages in this window."
                : "Nothing spent in this window."}
          </div>
        ) : (
          <>
            <div
              className="relative mx-auto mt-4 size-38"
              onPointerLeave={() => setActive(null)}
            >
              <svg viewBox="0 0 152 152" className="size-full">
                {slices.length === 1 ? (
                  <circle
                    cx="76"
                    cy="76"
                    r="57"
                    fill="none"
                    strokeWidth="34"
                    className={slices[0].style.stroke}
                    onPointerEnter={() => setActive(0)}
                  />
                ) : (
                  paths.map(({ slice, start, end, pad }, index) => (
                    <path
                      key={slice.key}
                      d={arcPath(76, 76, 74, 40, start + pad, end - pad)}
                      className={`${slice.style.fill} stroke-surface transition-opacity duration-100 ${
                        active !== null && active !== index
                          ? "opacity-45"
                          : "opacity-100"
                      }`}
                      strokeWidth="2"
                      strokeLinejoin="round"
                      onPointerEnter={() => setActive(index)}
                    />
                  ))
                )}
              </svg>
              {/* The cutout is 80px across but narrows toward its top and
                  bottom, so the column is capped at what fits at the height of
                  its outermost line — tighter once a third line pushes those
                  further out — and every line truncates rather than spilling
                  onto the ring. */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className={`flex flex-col items-center text-center ${
                    centerSub ? "w-15" : "w-17"
                  }`}
                >
                  <span className="max-w-full truncate text-[11px]/4 text-muted-foreground">
                    {centerTitle}
                  </span>
                  <span className="max-w-full truncate text-[15px]/5 font-semibold tabular-nums tracking-tight">
                    {centerValue}
                  </span>
                  {centerSub && (
                    <span className="max-w-full truncate text-[11px]/4 tabular-nums text-muted-foreground">
                      {centerSub}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <ul
              className="mt-4 space-y-1.5"
              onPointerLeave={() => setActive(null)}
            >
              {slices.map((slice, index) => (
                <li
                  key={slice.key}
                  onPointerEnter={() => setActive(index)}
                  className={`flex items-center gap-2 text-[13px]/[18px] transition-colors duration-100 ${
                    active === index
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`size-2.5 shrink-0 rounded-full ${slice.style.swatch}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{slice.label}</span>
                  {showValues && (
                    <span className="shrink-0 tabular-nums">
                      {formatValue(slice.value)}
                    </span>
                  )}
                  {!isFree && (
                    <span className="w-9 shrink-0 text-right tabular-nums">
                      {Math.round(slice.share * 100)}%
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </SettingsCard>
  );
}
