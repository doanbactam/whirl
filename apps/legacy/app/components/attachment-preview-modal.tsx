import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { IconX } from "@tabler/icons-react";

import { fileMeta } from "~/components/attachment-card";
import { ModalCard } from "~/components/modal-card";
import { formatSize } from "~/lib/attachment-upload";

/**
 * A peek at a text attachment's contents. Pass `onChange` to make it an
 * editable scratch pad (used in the composer, where edits ride along on send);
 * leave it off for a read-only view. Render inside an <AnimatePresence>; mount
 * only when there's text to show.
 */
export function AttachmentPreviewModal({
  name,
  type,
  size,
  text,
  onChange,
  onClose,
}: {
  name: string;
  type: string;
  size: number;
  text: string;
  onChange?: (text: string) => void;
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

  const meta = fileMeta(name, type);
  const Glyph = meta.icon;

  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh] bg-black/30 backdrop-blur-[6px] dark:bg-black/50"
    >
      <motion.div
        initial={{ opacity: 0, y: -8, scale: 0.97, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -4, scale: 0.98, filter: "blur(4px)" }}
        transition={{
          opacity: { duration: 0.18 },
          filter: { duration: 0.2 },
          y: { type: "spring", stiffness: 360, damping: 30 },
          scale: { type: "spring", stiffness: 360, damping: 30 },
        }}
        className="w-full max-w-2xl"
      >
        <ModalCard className="max-h-[78vh]">
        <div className="flex h-12 items-center gap-2.5 border-b border-black/[0.06] px-3.5 dark:border-white/[0.06]">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.tint}`}
          >
            <Glyph size={15} stroke={2} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
              {name}
            </span>
            <span className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
              {meta.label} · {formatSize(size)}
            </span>
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
        {onChange ? (
          <textarea
            value={text}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            aria-label={`Edit ${name}`}
            className="min-h-0 flex-1 resize-none overflow-auto whitespace-pre-wrap break-words bg-transparent px-4 py-3.5 font-mono text-[12.5px] leading-5 text-neutral-800 outline-none dark:text-neutral-200"
          />
        ) : (
          <div className="overflow-auto px-4 py-3.5">
            <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-5 text-neutral-800 dark:text-neutral-200">
              {text}
            </pre>
          </div>
        )}
        </ModalCard>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
