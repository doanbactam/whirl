import { useMemo } from "react";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import type { TablerIcon } from "@tabler/icons-react";
import {
  IconBarbell,
  IconBolt,
  IconFeather,
  IconRocket,
  IconSearch,
  IconSparkles,
  IconWand,
} from "@tabler/icons-react";

import { Spinner } from "~/components/spinner";
import { modelLabel } from "~/data/models";
import { formatUsd, formatUsdFine } from "~/lib/money";

const recentUsageRef = makeFunctionReference<"query">("messages:recentUsage");

type UsageRow = {
  id: string;
  threadId: string;
  createdAt: number;
  model: string;
  thinking: boolean;
  search: boolean;
  usageCost: number;
  extraUsageCost: number;
  searchSources: number;
  thoughtMs: number;
};

// Keyed by raw model key — retired tiers ("Pro") stay so old activity rows
// keep their glyph.
const MODEL_ICONS: Record<string, TablerIcon> = {
  Auto: IconWand,
  Fast: IconFeather,
  Basic: IconBolt,
  Pro: IconRocket,
  Max: IconBarbell,
};

/**
 * Recent requests that actually drew from the extra-usage bucket, shown in real
 * dollars — so a paid customer sees exactly what their purchased balance has
 * covered (everything billed to the plan pool is filtered out).
 */
export function ExtraUsageActivity({
  onSelect,
}: {
  onSelect: (threadId: string) => void;
}) {
  const all = useQuery(recentUsageRef, { limit: 100 }) as
    | UsageRow[]
    | undefined;

  const rows = useMemo(
    () => all?.filter((r) => r.extraUsageCost > 0),
    [all],
  );
  const total = useMemo(
    () => (rows ?? []).reduce((acc, r) => acc + r.extraUsageCost, 0),
    [rows],
  );

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
          Drawn from extra usage
        </span>
        {rows && rows.length > 0 ? (
          <span className="text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
            {formatUsd(total)} across {rows.length}{" "}
            {rows.length === 1 ? "request" : "requests"}
          </span>
        ) : null}
      </div>

      {rows === undefined ? (
        <div className="flex h-24 items-center justify-center rounded-xl border border-black/[0.06] dark:border-white/[0.06]">
          <Spinner size={16} className="text-blue-500" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-black/[0.1] px-4 text-center text-[12.5px] text-neutral-500 dark:border-white/[0.1] dark:text-neutral-400">
          Nothing drawn from extra usage yet — your plan's covered everything so
          far.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-black/[0.06] dark:border-white/[0.06]">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 bg-black/[0.02] px-3 py-2 text-[12px] font-medium text-neutral-500 dark:bg-white/[0.03] dark:text-neutral-400">
            <span>Request</span>
            <span>When</span>
            <span className="min-w-[72px] text-right">Cost</span>
          </div>
          <ul className="max-h-[240px] divide-y divide-black/[0.04] overflow-y-auto dark:divide-white/[0.05]">
            {rows.map((row) => {
              const Icon = MODEL_ICONS[row.model] ?? IconSparkles;
              const Glyph = row.search ? IconSearch : Icon;
              const details: string[] = [];
              if (row.search && row.searchSources > 0) {
                details.push(
                  `${row.searchSources} ${row.searchSources === 1 ? "source" : "sources"}`,
                );
              }
              if (row.thinking) details.push("thinking");
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.threadId)}
                    className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black/[0.05] text-neutral-700 dark:bg-white/[0.06] dark:text-neutral-200">
                        <Glyph size={14} stroke={2} />
                      </span>
                      <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                        {modelLabel(row.model)}
                        {details.length > 0 ? (
                          <span className="ml-1.5 text-[12px] font-normal text-neutral-500 dark:text-neutral-400">
                            · {details.join(" · ")}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <span className="shrink-0 text-[12px] text-neutral-500 dark:text-neutral-400">
                      {formatRelative(row.createdAt)}
                    </span>
                    <span className="min-w-[72px] shrink-0 text-right text-[12.5px] font-medium tabular-nums text-neutral-700 dark:text-neutral-200">
                      {formatUsdFine(row.extraUsageCost)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatRelative(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "Just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
