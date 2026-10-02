import { IconPuzzleFilled, IconTrash } from "@tabler/icons-react";

import { Skeleton } from "~/components/skeleton";
import { Switch } from "~/components/switch";
import { formatDate } from "~/lib/format";
import type { ComposioExtension } from "~/lib/backend";

// Shared column template so the header and rows always line up.
const gridClass =
  "grid grid-cols-[minmax(0,2.4fr)_64px_116px_110px_40px] items-center gap-3 px-4";

/**
 * The Composio extensions you've added, drafts and live ones alike. Loading
 * state while the query settles, a friendly nudge when the list is empty,
 * and a compact table with the publish switch once there's something here.
 */
export function AddedExtensions({
  added,
  onToggle,
  onRemove,
}: {
  added: ComposioExtension[] | undefined;
  onToggle: (extension: ComposioExtension, enabled: boolean) => void;
  onRemove: (extension: ComposioExtension) => void;
}) {
  if (added === undefined) return <AddedExtensionsSkeleton />;

  if (added.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-black/[0.06] bg-white px-5 py-6 dark:border-white/[0.06] dark:bg-[#1B1B1B]">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-neutral-400 dark:bg-white/[0.06] dark:text-neutral-500">
          <IconPuzzleFilled size={17} />
        </span>
        <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
          Nothing here yet — find a toolkit below and give it a home.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white dark:border-white/[0.06] dark:bg-[#1B1B1B]">
      <div
        className={`${gridClass} h-10 border-b border-black/[0.05] text-[11.5px] font-medium text-neutral-400 dark:border-white/[0.06] dark:text-neutral-500`}
      >
        <span>Extension</span>
        <span>Tools</span>
        <span>Status</span>
        <span>Added</span>
        <span />
      </div>
      <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
        {added.map((extension) => (
          <li
            key={extension.id}
            className={`${gridClass} min-h-[56px] py-2.5`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <ExtensionLogo
                logoUrl={extension.logoUrl}
                name={extension.name}
              />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                  {extension.name}
                </span>
                <span className="truncate text-[12px] text-neutral-500 dark:text-neutral-400">
                  {extension.description || extension.slug}
                </span>
              </div>
            </div>
            <span className="text-[12.5px] text-neutral-600 tabular-nums dark:text-neutral-300">
              {extension.toolCount}
            </span>
            <div className="flex items-center gap-2">
              <Switch
                checked={extension.enabled}
                onChange={(next) => onToggle(extension, next)}
                label={`${extension.enabled ? "Unpublish" : "Publish"} ${extension.name}`}
              />
              <span
                className={`text-[11.5px] ${
                  extension.enabled
                    ? "text-neutral-600 dark:text-neutral-300"
                    : "text-neutral-400 dark:text-neutral-500"
                }`}
              >
                {extension.enabled ? "Live" : "Draft"}
              </span>
            </div>
            <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
              {formatDate(extension.addedAt)}
            </span>
            <button
              type="button"
              aria-label={`Remove ${extension.name}`}
              onClick={() => onRemove(extension)}
              className="flex h-8 w-8 items-center justify-center justify-self-end rounded-lg text-neutral-400 transition-colors hover:bg-red-500/[0.08] hover:text-red-600 dark:hover:bg-red-500/[0.12] dark:hover:text-red-400"
            >
              <IconTrash size={15} stroke={2} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExtensionLogo({
  logoUrl,
  name,
  size = "h-8 w-8",
}: {
  logoUrl: string | null;
  name: string;
  size?: string;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={`${name} logo`}
        className={`${size} shrink-0 rounded-lg border border-black/[0.06] bg-white object-contain p-0.5 dark:border-white/[0.08]`}
      />
    );
  }
  return (
    <span
      className={`${size} flex shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-neutral-400 dark:bg-white/[0.06] dark:text-neutral-500`}
    >
      <IconPuzzleFilled size={15} />
    </span>
  );
}

function AddedExtensionsSkeleton() {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white dark:border-white/[0.06] dark:bg-[#1B1B1B]">
      <div className="h-10 border-b border-black/[0.05] dark:border-white/[0.06]" />
      <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
        {Array.from({ length: 2 }).map((_, i) => (
          <li key={i} className={`${gridClass} h-[56px]`}>
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-2.5 w-44" />
              </div>
            </div>
            <Skeleton className="h-3.5 w-8" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-3 w-16" />
            <span />
          </li>
        ))}
      </ul>
    </div>
  );
}
