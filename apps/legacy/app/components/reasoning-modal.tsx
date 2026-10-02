import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { IconBrain, IconX } from "@tabler/icons-react";

import { ModalCard } from "~/components/modal-card";

/**
 * Shows the raw model reasoning captured for a finalized "thought" phase.
 * Opened by clicking the persisted "Thought for N seconds" chip in a message.
 */
export function ReasoningModal({
  text,
  durationLabel,
  onClose,
}: {
  text: string;
  durationLabel?: string;
  onClose: () => void;
}) {
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
      key="reasoning-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Reasoning"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh] backdrop-blur-[6px] dark:bg-black/50"
    >
      <motion.div
        key="reasoning-modal"
        initial={{ opacity: 0, y: -8, scale: 0.97, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -4, scale: 0.98, filter: "blur(4px)" }}
        transition={{
          opacity: { duration: 0.18 },
          filter: { duration: 0.2 },
          y: { type: "spring", stiffness: 360, damping: 30 },
          scale: { type: "spring", stiffness: 360, damping: 30 },
        }}
        className="w-full max-w-xl"
      >
        <ModalCard>
        <div className="flex h-12 items-center gap-2.5 border-b border-black/[0.06] px-3.5 dark:border-white/[0.06]">
          <IconBrain
            size={16}
            stroke={2}
            className="shrink-0 text-neutral-400 dark:text-neutral-500"
          />
          <span className="flex-1 text-[14px] font-medium text-neutral-900 dark:text-neutral-100">
            Reasoning
            {durationLabel ? (
              <span className="ml-2 text-[12px] font-normal text-neutral-400 dark:text-neutral-500">
                {durationLabel}
              </span>
            ) : null}
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

        <div className="max-h-[min(60vh,520px)] overflow-y-auto px-4 py-3.5">
          <p className="text-[13.5px] leading-[1.7] whitespace-pre-wrap [overflow-wrap:anywhere] text-neutral-600 dark:text-neutral-300">
            {text}
          </p>
        </div>
        </ModalCard>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
