import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  IconDotsVertical,
  IconPencil,
  IconPlus,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";

import { MonoIcon } from "~/components/mono-icon";
import { Skeleton } from "~/components/skeleton";
import { Switch } from "~/components/switch";
import { formatDate } from "~/lib/format";
import type { AiModel } from "~/lib/backend";
import { CapabilityPills } from "./capability-pills";

// Shared column template so the header and rows always line up.
const gridClass =
  "grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_96px_76px_88px_40px] items-center gap-3 px-4";

export type ModelRowActions = {
  onEdit: (model: AiModel) => void;
  onToggle: (model: AiModel, enabled: boolean) => void;
  onLegacyToggle: (model: AiModel, legacy: boolean) => void;
  onDelete: (model: AiModel) => void;
};

export function ModelTable({
  models,
  actions,
}: {
  models: AiModel[];
  actions: ModelRowActions;
}) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white dark:border-white/[0.06] dark:bg-[#1B1B1B]">
      <div
        className={`${gridClass} h-10 border-b border-black/[0.05] text-[11.5px] font-medium text-neutral-400 dark:border-white/[0.06] dark:text-neutral-500`}
      >
        <span>Model</span>
        <span>Capabilities</span>
        <span>Status</span>
        <span>Legacy</span>
        <span>Added</span>
        <span />
      </div>
      <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
        {models.map((model) => (
          <ModelRow key={model.id} model={model} actions={actions} />
        ))}
      </ul>
    </div>
  );
}

function ModelRow({
  model,
  actions,
}: {
  model: AiModel;
  actions: ModelRowActions;
}) {
  return (
    <li className={`${gridClass} min-h-[60px] py-2.5`}>
      <div className="flex min-w-0 items-center gap-3">
        <ModelIconTile model={model} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
            {model.displayName}
            <span className="ml-2 text-[11.5px] font-normal text-neutral-400 dark:text-neutral-500">
              {model.company} {model.modelName}
            </span>
          </span>
          <span className="truncate font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
            {model.slug}
          </span>
        </div>
      </div>
      <CapabilityPills capabilities={model.capabilities} />
      <div className="flex items-center gap-2">
        <Switch
          checked={model.enabled}
          onChange={(next) => actions.onToggle(model, next)}
          label={`${model.enabled ? "Hide" : "Show"} ${model.displayName} in the picker`}
        />
        <span
          className={`text-[11.5px] ${
            model.enabled
              ? "text-neutral-600 dark:text-neutral-300"
              : "text-neutral-400 dark:text-neutral-500"
          }`}
        >
          {model.enabled ? "Live" : "Off"}
        </span>
      </div>
      {/* Legacy = search-only: the picker stops listing the model, but a
          typed search still finds it. */}
      <Switch
        checked={model.legacy}
        onChange={(next) => actions.onLegacyToggle(model, next)}
        label={`${model.legacy ? "Unmark" : "Mark"} ${model.displayName} as legacy (search-only in the picker)`}
      />
      <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
        {formatDate(model.createdAt)}
      </span>
      <RowMenu model={model} actions={actions} />
    </li>
  );
}

function ModelIconTile({ model }: { model: AiModel }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-neutral-400 dark:bg-white/[0.06] dark:text-neutral-500">
      {model.iconSvg ? (
        <MonoIcon svg={model.iconSvg} size={16} />
      ) : (
        <IconSparkles size={15} stroke={1.8} />
      )}
    </span>
  );
}

function RowMenu({
  model,
  actions,
}: {
  model: AiModel;
  actions: ModelRowActions;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = (onClick: () => void) => () => {
    setOpen(false);
    onClick();
  };

  return (
    <div ref={rootRef} className="relative justify-self-end">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${model.displayName}`}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200 ${
          open
            ? "bg-black/[0.05] dark:bg-white/[0.07]"
            : "hover:bg-black/[0.05] dark:hover:bg-white/[0.07]"
        }`}
      >
        <IconDotsVertical size={15} stroke={2} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12, ease: [0.22, 0.61, 0.36, 1] }}
            className="absolute top-full right-0 z-30 mt-1 w-44 rounded-xl border border-black/[0.06] bg-white p-1 shadow-xl dark:border-white/[0.08] dark:bg-[#242424]"
          >
            <MenuButton
              icon={<IconPencil size={14} stroke={2} />}
              onClick={item(() => actions.onEdit(model))}
            >
              Edit details
            </MenuButton>
            <div className="mx-1 my-1 h-px bg-black/[0.06] dark:bg-white/[0.08]" />
            <MenuButton
              icon={<IconTrash size={14} stroke={2} />}
              destructive
              onClick={item(() => actions.onDelete(model))}
            >
              Delete
            </MenuButton>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuButton({
  icon,
  children,
  onClick,
  destructive = false,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[12.5px] transition-colors ${
        destructive
          ? "text-red-600 hover:bg-red-500/[0.08] dark:text-red-400 dark:hover:bg-red-500/[0.12]"
          : "text-neutral-700 hover:bg-black/[0.05] dark:text-neutral-200 dark:hover:bg-white/[0.06]"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

export function ModelTableSkeleton() {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white dark:border-white/[0.06] dark:bg-[#1B1B1B]">
      <div className="h-10 border-b border-black/[0.05] dark:border-white/[0.06]" />
      <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className={`${gridClass} h-[60px]`}>
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-2.5 w-24" />
              </div>
            </div>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-8" />
            <Skeleton className="h-3 w-16" />
            <span />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ModelsEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-black/[0.06] bg-white px-6 py-14 text-center dark:border-white/[0.06] dark:bg-[#1B1B1B]">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/[0.05] text-neutral-700 dark:bg-white/[0.08] dark:text-neutral-200">
        <IconSparkles size={22} stroke={1.8} />
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          No custom models yet
        </h3>
        <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          Add an OpenRouter model and it joins the composer's search list in
          the new app.
        </p>
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-[13px] font-medium text-white transition hover:bg-blue-500"
      >
        <IconPlus size={15} stroke={2.5} />
        New model
      </button>
    </div>
  );
}
