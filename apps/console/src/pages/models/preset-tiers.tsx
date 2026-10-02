import { Link } from "react-router";
import { IconLock, IconPencil, IconRestore } from "@tabler/icons-react";

import { MonoIcon } from "~/components/mono-icon";
import { Skeleton } from "~/components/skeleton";
import { Switch } from "~/components/switch";
import type { AiModel } from "~/lib/backend";
import { AUTO_TIER, TIER_PRESETS, type TierPreset } from "./tier-data";

export type TierAccessControls = {
  /** Null while the restriction list is still loading. */
  restrictedTiers: ReadonlySet<string> | null;
  onAccessChange: (tier: string, restricted: boolean) => void;
};

/**
 * The preset tier lineup: Auto locked at the top, then the four tiers an
 * admin can point at a different OpenRouter model. Every row carries a
 * "free plan" switch — off means the tier is paid-only and free users see
 * it locked behind an upgrade prompt. A customized tier shows the override
 * and offers a reset back to the hardcoded default.
 */
export function PresetTiers({
  overrides,
  onReset,
  access,
}: {
  overrides: AiModel[];
  onReset: (override: AiModel) => void;
  access: TierAccessControls;
}) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white dark:border-white/[0.06] dark:bg-[#1B1B1B]">
      <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
        <AutoRow access={access} />
        {TIER_PRESETS.map((preset) => (
          <TierRow
            key={preset.key}
            preset={preset}
            override={overrides.find((row) => row.tier === preset.key)}
            onReset={onReset}
            access={access}
          />
        ))}
      </ul>
    </div>
  );
}

function AutoRow({ access }: { access: TierAccessControls }) {
  return (
    <li className="flex min-h-[60px] items-center gap-3 px-4 py-2.5">
      <TierBadge label={AUTO_TIER.label} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
          {AUTO_TIER.label}
          <span className="ml-2 font-mono text-[11px] font-normal text-neutral-400 dark:text-neutral-500">
            {AUTO_TIER.slug}
          </span>
        </span>
        <span className="truncate text-[12px] text-neutral-500 dark:text-neutral-400">
          {AUTO_TIER.blurb}
        </span>
      </div>
      <FreeAccessCell tier="Auto" label={AUTO_TIER.label} access={access} />
      <span className="flex items-center gap-1.5 text-[11.5px] text-neutral-400 dark:text-neutral-500">
        <IconLock size={13} stroke={2} />
        Always Auto
      </span>
    </li>
  );
}

function TierRow({
  preset,
  override,
  onReset,
  access,
}: {
  preset: TierPreset;
  override: AiModel | undefined;
  onReset: (override: AiModel) => void;
  access: TierAccessControls;
}) {
  return (
    <li className="flex min-h-[60px] items-center gap-3 px-4 py-2.5">
      {override?.iconSvg ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] dark:bg-white/[0.06]">
          <MonoIcon svg={override.iconSvg} size={16} />
        </span>
      ) : (
        <TierBadge label={preset.label} />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
          {preset.label}
          <span className="ml-2 font-mono text-[11px] font-normal text-neutral-400 dark:text-neutral-500">
            {override ? override.slug : preset.defaultSlug}
          </span>
        </span>
        <span className="truncate text-[12px] text-neutral-500 dark:text-neutral-400">
          {override
            ? `Customized — running ${override.company} ${override.modelName}.`
            : preset.blurb}
        </span>
      </div>
      {override && (
        <span className="rounded-full bg-blue-500/[0.1] px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-500/[0.16] dark:text-blue-300">
          Customized
        </span>
      )}
      <FreeAccessCell tier={preset.key} label={preset.label} access={access} />
      <div className="flex items-center gap-1">
        {override && (
          <button
            type="button"
            onClick={() => onReset(override)}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-neutral-500 transition-colors hover:bg-black/[0.05] hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/[0.07] dark:hover:text-neutral-200"
          >
            <IconRestore size={13} stroke={2} />
            Reset
          </button>
        )}
        <Link
          to={`/models/tiers/${preset.key}`}
          className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-neutral-600 transition-colors hover:bg-black/[0.05] hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/[0.07] dark:hover:text-neutral-100"
        >
          <IconPencil size={13} stroke={2} />
          Customize
        </Link>
      </div>
    </li>
  );
}

/**
 * The free-plan switch: on = free users can pick this tier, off = it's
 * paid-only ("Paid only" pill in gray, and the composer shows it locked
 * with an upgrade prompt).
 */
function FreeAccessCell({
  tier,
  label,
  access,
}: {
  tier: string;
  label: string;
  access: TierAccessControls;
}) {
  const { restrictedTiers, onAccessChange } = access;
  if (restrictedTiers === null) {
    return <Skeleton className="h-4 w-20 shrink-0" />;
  }
  const restricted = restrictedTiers.has(tier);
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Switch
        checked={!restricted}
        onChange={(allowed) => onAccessChange(tier, !allowed)}
        label={`${restricted ? "Allow" : "Block"} ${label} on the free plan`}
      />
      <span
        className={`w-16 text-[11.5px] ${
          restricted
            ? "text-neutral-400 dark:text-neutral-500"
            : "text-neutral-600 dark:text-neutral-300"
        }`}
      >
        {restricted ? "Paid only" : "Free plan"}
      </span>
    </div>
  );
}

/** Fallback tile when a tier has no custom icon: its label's initial. */
function TierBadge({ label }: { label: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-[12px] font-semibold text-neutral-500 dark:bg-white/[0.06] dark:text-neutral-400">
      {label.charAt(0)}
    </span>
  );
}

export function PresetTiersSkeleton() {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white dark:border-white/[0.06] dark:bg-[#1B1B1B]">
      <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex h-[60px] items-center gap-3 px-4">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-44" />
              <Skeleton className="h-2.5 w-28" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
