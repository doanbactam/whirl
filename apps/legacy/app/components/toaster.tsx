import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  IconAlertTriangle,
  IconCheck,
  IconReload,
  IconTrash,
} from "@tabler/icons-react";

import { Squircle } from "~/components/squircle";
import { dismissToast, useToasts } from "~/data/toasts";

export function Toaster() {
  const toasts = useToasts();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 md:bottom-6 md:left-auto md:right-6 md:translate-x-0 md:items-end md:px-0"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          // Tone-less toasts are plain acknowledgements, so they default to a
          // calm neutral badge — only an explicit `danger`/`info`/`success`
          // tone paints a louder colour or warning icon.
          const tone = toast.tone ?? "neutral";
          const badgeClass =
            tone === "info"
              ? "bg-[#0c82f2]/10 text-[#0c82f2] dark:bg-[#4aa8ff]/15 dark:text-[#4aa8ff]"
              : tone === "success"
                ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                : tone === "danger"
                  ? "bg-red-500/10 text-red-500 dark:bg-red-500/15 dark:text-red-400"
                  : "bg-black/[0.06] text-neutral-500 dark:bg-white/[0.1] dark:text-neutral-300";
          const Glyph =
            tone === "info"
              ? IconReload
              : tone === "success"
                ? IconCheck
                : tone === "danger"
                  ? toast.action
                    ? IconTrash
                    : IconAlertTriangle
                  : toast.action
                    ? IconTrash
                    : IconCheck;
          return (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{
              opacity: { duration: 0.18 },
              y: { type: "spring", stiffness: 380, damping: 30 },
              scale: { type: "spring", stiffness: 380, damping: 30 },
              layout: { type: "spring", stiffness: 380, damping: 30 },
            }}
            role="status"
            className="pointer-events-auto"
          >
            <Squircle
              radius={12}
              className="flex items-center gap-3 rounded-xl border border-black/[0.06] bg-white px-3.5 py-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.14),_0_2px_6px_rgba(0,0,0,0.06)] dark:border-white/[0.06] dark:bg-[#1E1E1E] dark:shadow-[0_12px_32px_rgba(0,0,0,0.5),_0_2px_6px_rgba(0,0,0,0.3)]"
            >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${badgeClass}`}
            >
              <Glyph size={14} stroke={2.25} />
            </span>
            <span className="flex-1 truncate text-[13px] text-neutral-800 dark:text-neutral-100">
              {toast.message}
            </span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  dismissToast(toast.id);
                }}
                className="shrink-0 rounded-md px-2 py-1 text-[12.5px] font-medium text-[#0c82f2] hover:bg-[#0c82f2]/10 dark:text-[#4aa8ff] dark:hover:bg-[#4aa8ff]/10"
              >
                {toast.action.label}
              </button>
            )}
            </Squircle>
          </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
