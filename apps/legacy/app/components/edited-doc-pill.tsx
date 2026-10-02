import { IconX } from "@tabler/icons-react";

import { fileMeta } from "~/components/attachment-card";

/**
 * A compact, neutral pill for a document carrying edits back to a sent message.
 * Edited markdown is just text (no upload), so it doesn't need the full file
 * card — a small rounded chip with the file icon, name and an "edited" hint
 * reads lighter while still being clickable to reopen the editor.
 */
export function EditedDocPill({
  name,
  type,
  onClick,
  onRemove,
  removeLabel,
}: {
  name: string;
  type: string;
  onClick?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const meta = fileMeta(name, type);
  const Glyph = meta.icon;

  return (
    <div className="group/att relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        className="flex max-w-[220px] items-center gap-1.5 rounded-full border border-black/[0.08] bg-black/[0.03] py-1 pl-2 pr-2.5 text-left transition-colors hover:bg-black/[0.05] dark:border-white/[0.1] dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
      >
        <Glyph
          size={13}
          stroke={2}
          className="shrink-0 text-neutral-500 dark:text-neutral-400"
        />
        <span className="truncate text-[12px] font-medium text-neutral-700 dark:text-neutral-200">
          {name}
        </span>
        <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
          edited
        </span>
      </button>
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel ?? `Remove ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-black/[0.06] bg-white text-neutral-500 opacity-0 shadow-sm transition-opacity hover:text-neutral-800 group-hover/att:opacity-100 focus-visible:opacity-100 dark:border-white/[0.1] dark:bg-[#2a2a2a] dark:text-neutral-300 dark:hover:text-neutral-100"
        >
          <IconX size={11} stroke={2.5} />
        </button>
      ) : null}
    </div>
  );
}
