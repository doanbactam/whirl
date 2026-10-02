import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { TablerIcon } from "@tabler/icons-react";
import {
  IconAlignLeft,
  IconCheck,
  IconPaperclip,
  IconX,
} from "@tabler/icons-react";

import { ModalCard } from "~/components/modal-card";

export type PasteChoice = "message" | "attachment";

type Props = {
  open: boolean;
  charCount: number;
  onChoose: (choice: PasteChoice, dontAskAgain: boolean) => void;
  onClose: () => void;
};

/**
 * Asks whether a big chunk of pasted text should land inline in the composer
 * or ride along as a `.md` attachment. Shows up only past the length
 * threshold, so short pastes never get interrupted. The "don't ask again"
 * tickbox rides along with the choice so the caller can silence the dialog
 * for good.
 */
export function PasteChoiceModal({ open, charCount, onChoose, onClose }: Props) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDontAskAgain(false);
    const id = requestAnimationFrame(() => primaryRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="paste-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/30 backdrop-blur-[6px] dark:bg-black/50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            key="paste-modal"
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
            aria-label="Paste options"
            className="w-full max-w-md"
          >
            <ModalCard>
            <div className="flex items-start justify-between gap-3 p-4 pb-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
                  That's a big paste
                </span>
                <span className="text-[12.5px] leading-5 text-neutral-500 dark:text-neutral-400">
                  {charCount.toLocaleString()} characters — keep it inline, or
                  tuck it into a file?
                </span>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
              >
                <IconX size={14} stroke={2.5} />
              </button>
            </div>
            <div className="flex flex-col gap-2 p-4 pt-1">
              <ChoiceButton
                ref={primaryRef}
                icon={IconAlignLeft}
                title="Paste as message"
                blurb="Drop the text straight into the composer"
                onClick={() => onChoose("message", dontAskAgain)}
              />
              <ChoiceButton
                icon={IconPaperclip}
                title="Paste as attachment"
                blurb="Stash it in a .md file and attach it"
                onClick={() => onChoose("attachment", dontAskAgain)}
              />
              <button
                type="button"
                role="checkbox"
                aria-checked={dontAskAgain}
                onClick={() => setDontAskAgain((v) => !v)}
                className="group mt-0.5 flex items-center gap-2 self-start rounded-md px-1 py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#178dfb]/40"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
                    dontAskAgain
                      ? "border-[#0c82f2] bg-[#0c82f2] text-white"
                      : "border-black/[0.18] bg-white group-hover:border-black/30 dark:border-white/[0.22] dark:bg-white/[0.04] dark:group-hover:border-white/40"
                  }`}
                >
                  {dontAskAgain && <IconCheck size={11} stroke={3.5} />}
                </span>
                <span className="text-[12px] text-neutral-500 transition-colors group-hover:text-neutral-700 dark:text-neutral-400 dark:group-hover:text-neutral-200">
                  Don't ask again — always paste as text
                </span>
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

const ChoiceButton = ({
  ref,
  icon,
  title,
  blurb,
  onClick,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  icon: TablerIcon;
  title: string;
  blurb: string;
  onClick: () => void;
}) => {
  const Glyph = icon;
  return (
  <motion.button
    ref={ref}
    type="button"
    onClick={onClick}
    whileTap={{ scale: 0.98 }}
    className="flex items-center gap-3 rounded-2xl border border-black/[0.06] bg-white/70 p-3 text-left transition-colors hover:bg-black/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#178dfb]/40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
  >
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0c82f2]/10 text-[#0c82f2] dark:bg-[#0c82f2]/15">
      <Glyph size={18} stroke={2} />
    </span>
    <span className="flex min-w-0 flex-col">
      <span className="text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
        {title}
      </span>
      <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
        {blurb}
      </span>
    </span>
  </motion.button>
  );
};
