import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconGitBranch, IconRestore } from "@tabler/icons-react";

import { ConfirmDialog } from "~/components/confirm-dialog";
import {
  DropdownShell,
  dropdownItemCompactClass,
} from "~/components/dropdown-menu";
import { ActionButton } from "~/components/message-action-button";

/**
 * The per-message checkpoint control: one little branch icon that opens a menu
 * with the two timeline actions — branch the conversation up to this point
 * into a fresh thread, or roll the thread back to here by deleting everything
 * after. Both confirm before doing anything.
 */
export function CheckpointMenu({
  alignEnd,
  onBranch,
  onRollback,
}: {
  /** True under user messages (the action row hugs the right edge). */
  alignEnd: boolean;
  onBranch: () => void;
  /** Absent when there's nothing after this message to roll back. */
  onRollback?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const [confirming, setConfirming] = useState<"branch" | "rollback" | null>(
    null,
  );
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
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

  const toggle = () => {
    if (!open && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      // Open upward when the message sits near the bottom (over the composer).
      setFlip(window.innerHeight - rect.bottom < 160);
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={wrapRef} className="relative">
      <ActionButton icon={IconGitBranch} label="Checkpoint" onClick={toggle} />
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: flip ? 3 : -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: flip ? 3 : -3 }}
            transition={{ duration: 0.12, ease: [0.22, 0.61, 0.36, 1] }}
            className={`absolute z-30 w-44 ${
              alignEnd ? "right-0" : "left-0"
            } ${flip ? "bottom-full mb-1" : "top-full mt-1"}`}
          >
            <DropdownShell>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setConfirming("branch");
                }}
                className={dropdownItemCompactClass}
              >
                <IconGitBranch size={14} stroke={2} />
                Branch off here
              </button>
              {onRollback && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setConfirming("rollback");
                  }}
                  className={`${dropdownItemCompactClass} text-red-600 hover:bg-red-500/10 dark:text-red-400`}
                >
                  <IconRestore size={14} stroke={2} />
                  Roll back to here
                </button>
              )}
            </DropdownShell>
          </motion.div>
        )}
      </AnimatePresence>
      <ConfirmDialog
        open={confirming === "branch"}
        title="Branch off from here?"
        message="Copies the conversation up to this message into a new thread and takes you there. The original thread stays untouched."
        confirmLabel="Branch off"
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          onBranch();
        }}
      />
      <ConfirmDialog
        open={confirming === "rollback"}
        title="Roll back to this point?"
        message="Everything after this message will be deleted from the thread. This can't be undone — branch off first if you want to keep both timelines."
        confirmLabel="Roll back"
        tone="danger"
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          onRollback?.();
        }}
      />
    </div>
  );
}
