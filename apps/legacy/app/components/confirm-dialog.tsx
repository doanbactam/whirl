import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";

import { ModalCard } from "~/components/modal-card";

type Props = {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" paints the confirm button red for destructive actions. */
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * A small yes/no confirmation modal, styled to match the app's other dialogs
 * (rename, paste-choice). Escape or a backdrop click cancels; the cancel button
 * takes focus so a stray Enter never fires a destructive action by accident.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => cancelRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onCancel]);

  if (typeof document === "undefined") return null;

  const confirmClass =
    tone === "danger"
      ? "bg-red-500 hover:bg-red-600"
      : "bg-[#0c82f2] hover:bg-[#0a74d8]";

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="confirm-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 px-4 backdrop-blur-[6px] dark:bg-black/50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onCancel();
          }}
        >
          <motion.div
            key="confirm-modal"
            initial={{ opacity: 0, y: -8, scale: 0.97, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -4, scale: 0.98, filter: "blur(4px)" }}
            transition={{
              opacity: { duration: 0.18 },
              filter: { duration: 0.2 },
              y: { type: "spring", stiffness: 360, damping: 30 },
              scale: { type: "spring", stiffness: 360, damping: 30 },
            }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="w-full max-w-md"
          >
            <ModalCard>
            <div className="flex flex-col gap-1.5 p-4">
              <span className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
                {title}
              </span>
              {message ? (
                <span className="text-[12.5px] leading-5 text-neutral-500 dark:text-neutral-400">
                  {message}
                </span>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-black/[0.06] bg-black/[0.02] px-4 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.02]">
              <button
                ref={cancelRef}
                type="button"
                onClick={onCancel}
                className="h-8 rounded-md px-3 text-[13px] font-medium text-neutral-600 hover:bg-black/[0.05] dark:text-neutral-300 dark:hover:bg-white/[0.06]"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={`h-8 rounded-md px-3 text-[13px] font-medium text-white ${confirmClass}`}
              >
                {confirmLabel}
              </button>
            </div>
            </ModalCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
