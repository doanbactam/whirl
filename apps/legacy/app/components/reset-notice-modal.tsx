import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import confetti from "canvas-confetti";

import { Squircle } from "~/components/squircle";
import { acknowledgeResetNoticeRef, usePendingResetNotice } from "~/lib/admin";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

// Plain brand blue for the modal's cap.
const CAP_COLOR = "#178dfb";

const CONFETTI_COLORS = [
  "#ef4444",
  "#f59e0b",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

/** A celebratory burst: a center pop plus side cannons for a beat. */
function celebrate() {
  confetti({
    particleCount: 120,
    spread: 80,
    startVelocity: 45,
    origin: { x: 0.5, y: 0.5 },
    colors: CONFETTI_COLORS,
    zIndex: 100,
  });
  const end = Date.now() + 1000;
  const frame = () => {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 60,
      origin: { x: 0, y: 0.7 },
      colors: CONFETTI_COLORS,
      zIndex: 100,
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 60,
      origin: { x: 1, y: 0.7 },
      colors: CONFETTI_COLORS,
      zIndex: 100,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}

/**
 * One-time modal shown when an admin has reset the signed-in user's usage quota.
 * The copy is admin-supplied at reset time. Showing it rains confetti; dismissing
 * clears the notice server-side, so it reactively disappears and never repeats.
 */
export function ResetNoticeModal() {
  const notice = usePendingResetNotice();
  const acknowledge = useMutation(acknowledgeResetNoticeRef);
  const capture = useCapture();
  const celebratedFor = useRef<number | null>(null);

  const ack = () => {
    capture(ANALYTICS_EVENTS.resetNoticeAcknowledged);
    void acknowledge({});
  };

  // Fire confetti once per distinct notice (keyed by its createdAt).
  useEffect(() => {
    if (!notice) return;
    if (celebratedFor.current === notice.createdAt) return;
    celebratedFor.current = notice.createdAt;
    celebrate();
  }, [notice?.createdAt]);

  if (typeof document === "undefined") return null;

  const open = Boolean(notice);

  return createPortal(
    <AnimatePresence>
      {open && notice && (
        <motion.div
          key="reset-notice-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[6px]"
          onClick={ack}
        >
          <motion.div
            key="reset-notice-card"
            initial={{ opacity: 0, scale: 0.9, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 6 }}
            transition={{ type: "spring", stiffness: 380, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm"
          >
            <Squircle
              radius={12}
              className="overflow-hidden rounded-3xl bg-white text-center shadow-2xl dark:bg-[#1a1a1a]"
            >
            {/* Festive cap */}
            <div
              className="relative h-24"
              style={{ backgroundColor: CAP_COLOR }}
            >
              <motion.span
                initial={{ scale: 0, rotate: -25 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{
                  type: "spring",
                  stiffness: 320,
                  damping: 14,
                  delay: 0.05,
                }}
                className="absolute inset-0 flex items-center justify-center text-5xl drop-shadow-sm"
              >
                🎉
              </motion.span>
            </div>

            <div className="px-6 pb-6 pt-5">
              <h2 className="text-[18px] font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
                Quota reset!
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300">
                {notice.message}
              </p>
              <button
                type="button"
                onClick={ack}
                className="depth-blue mt-5 inline-flex h-10 w-full items-center justify-center rounded-xl text-[13px] font-semibold text-white"
              >
                Let&apos;s go
              </button>
            </div>
            </Squircle>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
