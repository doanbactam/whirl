import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { IconPencil, IconPin, IconTrash } from "@tabler/icons-react";
import type { TablerIcon } from "@tabler/icons-react";

type Props = {
  open: boolean;
  threadTitle: string;
  isPinned: boolean;
  onClose: () => void;
  onPin: () => void;
  onRename: () => void;
  onDelete: () => void;
};

function ActionRow({
  icon,
  label,
  description,
  onClick,
  destructive,
}: {
  icon: TablerIcon;
  label: string;
  description?: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  const Glyph = icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl px-1 py-3.5 text-left transition active:bg-black/[0.06] dark:active:bg-white/[0.06] ${
        destructive ? "text-red-600 dark:text-red-400" : "text-neutral-900 dark:text-neutral-100"
      }`}
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
          destructive
            ? "bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-400"
            : "bg-black/[0.05] text-neutral-700 dark:bg-white/[0.08] dark:text-neutral-200"
        }`}
      >
        <Glyph size={20} stroke={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-medium leading-tight">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-[13px] leading-snug text-neutral-500 dark:text-neutral-400">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function ThreadActionsSheet({
  open,
  threadTitle,
  isPinned,
  onClose,
  onPin,
  onRename,
  onDelete,
}: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  const displayTitle = threadTitle.trim() || "Untitled chat";

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="thread-actions-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/45 backdrop-blur-sm md:hidden"
          onClick={onClose}
        >
          <motion.div
            key="thread-actions-panel"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Thread actions"
            className="max-h-[min(70dvh,420px)] overflow-hidden rounded-t-[20px] border-t border-black/[0.06] bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_40px_rgba(0,0,0,0.18)] dark:border-white/[0.08] dark:bg-[#1c1c1c] dark:shadow-[0_-8px_40px_rgba(0,0,0,0.55)]"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" />
            <p className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              Thread
            </p>
            <p className="mb-4 truncate px-1 text-[17px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
              {displayTitle}
            </p>
            <div className="flex flex-col border-t border-black/[0.06] pt-1 dark:border-white/[0.06]">
              <ActionRow
                icon={IconPin}
                label={isPinned ? "Unpin" : "Pin"}
                description={
                  isPinned
                    ? "Remove from pinned at the top"
                    : "Keep this chat at the top of your list"
                }
                onClick={() => {
                  onPin();
                  onClose();
                }}
              />
              <ActionRow
                icon={IconPencil}
                label="Rename"
                description="Change how this thread appears in your list"
                onClick={() => {
                  onRename();
                  onClose();
                }}
              />
              <ActionRow
                icon={IconTrash}
                label="Delete"
                description="Remove this conversation permanently"
                onClick={() => {
                  onDelete();
                  onClose();
                }}
                destructive
              />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 flex h-12 w-full items-center justify-center rounded-2xl bg-black/[0.04] text-[15px] font-medium text-neutral-700 transition active:bg-black/[0.08] dark:bg-white/[0.06] dark:text-neutral-200 dark:active:bg-white/[0.1]"
            >
              Cancel
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
