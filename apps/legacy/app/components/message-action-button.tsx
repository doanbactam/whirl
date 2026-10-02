import type { TablerIcon } from "@tabler/icons-react";

/**
 * The little 28px icon button that lives in a message's action row (copy,
 * edit, retry, branch, …), with the shared CSS-only tooltip. Kept in its own
 * file so every action — including ones defined outside message-bubble.tsx —
 * renders identically.
 */
export function ActionButton({
  icon: Glyph,
  label,
  onClick,
}: {
  icon: TablerIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <div className="group/btn relative">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-black/[0.05] hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-neutral-100"
      >
        <Glyph size={14} stroke={2} />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 scale-95 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-sm transition-[opacity,transform] duration-150 group-hover/btn:scale-100 group-hover/btn:opacity-100 group-focus-visible/btn:scale-100 group-focus-visible/btn:opacity-100 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {label}
      </span>
    </div>
  );
}
