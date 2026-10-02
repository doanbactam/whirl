import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";

import { ModalCard } from "~/components/modal-card";

type Props = {
  open: boolean;
  initialTitle: string;
  /** Label above the input; defaults to the classic thread rename. */
  label?: string;
  placeholder?: string;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: (title: string) => void;
};

export function RenameModal({
  open,
  initialTitle,
  label = "Rename thread",
  placeholder = "Thread title",
  submitLabel = "Save",
  onClose,
  onSubmit,
}: Props) {
  const [value, setValue] = useState(initialTitle);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) setValue(initialTitle);
  }, [open, initialTitle]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const commit = () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === initialTitle) {
      onClose();
      return;
    }
    onSubmit(trimmed);
    onClose();
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="rename-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[22vh] backdrop-blur-[6px] dark:bg-black/50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            key="rename-modal"
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
            aria-label={label}
            className="w-full max-w-md"
          >
            <ModalCard>
            <div className="flex flex-col gap-3 p-4">
              <label
                htmlFor="rename-thread-input"
                className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400"
              >
                {label}
              </label>
              <input
                id="rename-thread-input"
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  }
                }}
                placeholder={placeholder}
                className="h-10 rounded-lg border border-black/[0.08] bg-transparent px-3 text-[14px] text-neutral-900 placeholder:text-neutral-400 focus:border-[#178dfb] focus:outline-none focus:ring-2 focus:ring-[#178dfb]/30 dark:border-white/[0.08] dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-black/[0.06] bg-black/[0.02] px-4 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.02]">
              <button
                type="button"
                onClick={onClose}
                className="h-8 rounded-md px-3 text-[13px] font-medium text-neutral-600 hover:bg-black/[0.05] dark:text-neutral-300 dark:hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={commit}
                disabled={!value.trim() || value.trim() === initialTitle}
                className="h-8 rounded-md bg-[#0c82f2] px-3 text-[13px] font-medium text-white hover:bg-[#0a74d8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitLabel}
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
