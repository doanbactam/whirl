import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { IconX } from "@tabler/icons-react";

import { MemoryRow } from "~/components/memory-settings";
import { ModalCard } from "~/components/modal-card";
import { UnifiedMemoryIcon } from "~/components/unified-memory-icon";
import { Spinner } from "~/components/spinner";
import { useMemoriesByIds, useMemoryMutations } from "~/data/memory";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

/**
 * Sits beside a message's Copy/Retry actions when that assistant turn saved
 * something to the legacy local memory store. Reads "N memory added"; clicking
 * opens a modal to review, edit, or delete exactly what this turn remembered.
 */
export function MemoryAddedIndicator({ memoryIds }: { memoryIds: string[] }) {
  const [open, setOpen] = useState(false);
  const capture = useCapture();
  const count = memoryIds.length;
  if (count === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          capture(ANALYTICS_EVENTS.memoryIndicatorOpened, { count });
          setOpen(true);
        }}
        className="ml-1 flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium text-neutral-500 transition-colors hover:bg-black/[0.05] hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-neutral-200"
      >
        <UnifiedMemoryIcon size={13} />
        {count === 1 ? "1 memory added" : `${count} memories added`}
      </button>
      <AnimatePresence>
        {open && (
          <MemoryAddedModal
            memoryIds={memoryIds}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function MemoryAddedModal({
  memoryIds,
  onClose,
}: {
  memoryIds: string[];
  onClose: () => void;
}) {
  const memories = useMemoriesByIds(memoryIds);
  const { updateMemory, deleteMemory } = useMemoryMutations();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      key="memory-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Memories added"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[14vh] backdrop-blur-[6px] dark:bg-black/50"
    >
      <motion.div
        key="memory-modal"
        initial={{ opacity: 0, y: -8, scale: 0.97, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -4, scale: 0.98, filter: "blur(4px)" }}
        transition={{
          opacity: { duration: 0.18 },
          filter: { duration: 0.2 },
          y: { type: "spring", stiffness: 360, damping: 30 },
          scale: { type: "spring", stiffness: 360, damping: 30 },
        }}
        className="w-full max-w-md"
      >
        <ModalCard>
        <div className="flex h-12 items-center gap-2.5 border-b border-black/[0.06] px-3.5 dark:border-white/[0.06]">
          <UnifiedMemoryIcon
            size={15}
            className="text-neutral-500 dark:text-neutral-400"
          />
          <span className="flex-1 text-[14px] font-medium text-neutral-900 dark:text-neutral-100">
            Added to memory
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
          >
            <IconX size={12} stroke={2.5} />
          </button>
        </div>

        <div className="max-h-[min(55vh,440px)] overflow-y-auto px-1.5 py-1">
          {memories === undefined ? (
            <div className="flex h-20 items-center justify-center">
              <Spinner size={16} className="text-blue-500" />
            </div>
          ) : memories.length === 0 ? (
            <div className="flex h-20 items-center justify-center px-6 text-center text-[12.5px] text-neutral-500 dark:text-neutral-400">
              These memories have since been removed.
            </div>
          ) : (
            <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
              <AnimatePresence initial={false}>
                {memories.map((memory) => (
                  <MemoryRow
                    key={memory.id}
                    memory={memory}
                    onSave={updateMemory}
                    onDelete={deleteMemory}
                  />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>

        <div className="border-t border-black/[0.06] px-3.5 py-2 dark:border-white/[0.06]">
          <p className="text-[11.5px] text-neutral-400 dark:text-neutral-500">
            New memory is managed automatically by Supermemory.
          </p>
        </div>
        </ModalCard>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
